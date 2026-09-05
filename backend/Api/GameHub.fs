module BibleGuessr.Api.GameHub

open System
open System.Threading.Tasks
open Microsoft.AspNetCore.SignalR
open BibleGuessr.Domain

/// The always-open room everyone lands in via "World chat" — just pick a
/// name, no room code needed. Reserved as a non-numeric code so it can
/// never collide with a randomly generated room code (those are always
/// 4 digits, see CreateRoom).
[<Literal>]
let WorldChatRoomCode = "WORLD"

/// In-memory room registry for multiplayer sessions.
/// Fine for a single-instance dev/hobby deployment; swap for a distributed
/// store (Redis backplane + shared state) before scaling out to multiple
/// server instances.
type RoomStore() =
    let rooms = System.Collections.Concurrent.ConcurrentDictionary<string, Room>()

    // Tracks which room/player a hub connection belongs to, so a later call
    // on the same connection (e.g. SendChatMessage) can identify its sender
    // without trusting a client-supplied identity.
    let connections = System.Collections.Concurrent.ConcurrentDictionary<string, RoomCode * Player>()

    member _.TryGet(code: string) =
        match rooms.TryGetValue(code) with
        | true, room -> Some room
        | false, _ -> None

    /// Atomically reads the room at `code`, applies `f`, and stores the
    /// result — all as one operation, via ConcurrentDictionary's real
    /// compare-and-swap (TryUpdate, retried in a loop under contention)
    /// rather than a separate TryGet -> compute -> Set sequence. Returns
    /// the room actually stored, or None if `code` doesn't exist (and
    /// never creates one — see below).
    ///
    /// This exists because TryGet -> compute -> Set (what every hub
    /// method used to do) is NOT atomic as a whole, even though each
    /// individual step is: two concurrent callers can both TryGet the
    /// same starting snapshot, each compute a different next room from
    /// it, and then Set one after the other — the second Set silently
    /// discards the first caller's entire update, as if it never
    /// happened. This is exactly what let two players' near-simultaneous
    /// SubmitGuess calls (or a disconnect racing a chat message, etc.)
    /// lose a guess or resurrect an already-ended ActiveGame, leaving a
    /// room permanently stuck ("You can't send a play request while a
    /// game is in progress" with no game visibly running) — see
    /// RoomStoreConcurrencyTests.fs.
    ///
    /// A missing key can't be updated in place (there's nothing to apply
    /// `f` to), so this deliberately does NOT create one via AddOrUpdate
    /// — every call site already treats "room not found" as its own case
    /// (typically an "Error" reply to the caller), so silently minting a
    /// fresh empty room here would paper over what should be a visible
    /// error instead.
    member _.Update(code: string, f: Room -> Room) : Room option =
        let rec attempt () =
            match rooms.TryGetValue(code) with
            | false, _ -> None
            | true, current ->
                let next = f current

                if rooms.TryUpdate(code, next, current) then
                    Some next
                else
                    // Someone else's Update/Set landed between our read and
                    // this TryUpdate — `current` is stale, retry against
                    // whatever's there now rather than silently losing this
                    // caller's change (the exact bug this method fixes).
                    attempt ()

        attempt ()

    member _.CreateRoom() =
        let code = Random.Shared.Next(1000, 9999) |> string
        let room = Room.create (RoomCode code)
        rooms[code] <- room
        room

    /// Ensures the World chat room exists, creating it on first use. Safe
    /// to call concurrently — GetOrAdd is atomic per key.
    member _.GetOrCreateWorldRoom() =
        rooms.GetOrAdd(WorldChatRoomCode, fun code -> Room.create (RoomCode code))

    member _.RegisterConnection(connectionId: string, roomCode: RoomCode, player: Player) =
        connections[connectionId] <- (roomCode, player)

    member _.TryGetConnection(connectionId: string) =
        match connections.TryGetValue(connectionId) with
        | true, value -> Some value
        | false, _ -> None

    /// Drops the connectionId -> (room, player) mapping — called from
    /// OnDisconnectedAsync. The player itself isn't removed from the room
    /// here; that only happens once PlayerCleanupService's sweep decides
    /// they've been gone long enough (see Room.removeStaleDisconnections).
    member _.RemoveConnection(connectionId: string) =
        connections.TryRemove(connectionId) |> ignore

    /// All rooms currently tracked, for PlayerCleanupService's periodic
    /// sweep.
    member _.AllRooms() = rooms.Values |> List.ofSeq

/// Messages the server pushes to clients. Keep in sync with the Lit
/// frontend's SignalR event handlers (frontend/src/signalr-client.ts).
[<Literal>]
let PlayerJoinedEvent = "PlayerJoined"

[<Literal>]
let RoundStartedEvent = "RoundStarted"

[<Literal>]
let RoundScoredEvent = "RoundScored"

[<Literal>]
let ChatMessageReceivedEvent = "ChatMessageReceived"

/// Sent only to a newly-joined player, once, right after they join — the
/// room's last Room.maxRecentMessages messages (oldest first, so the
/// client can just append them in order), so they land in a chat that
/// already has context instead of an empty one.
[<Literal>]
let ChatHistoryEvent = "ChatHistory"

/// Sent only to a newly-joined player, once, right after they join — a
/// full snapshot of everyone currently in the room (including the joiner
/// themself), so players who joined earlier are visible/clickable right
/// away instead of only ever appearing via a future PlayerJoined.
[<Literal>]
let RoomPlayersEvent = "RoomPlayers"

/// Sent to the room when a play request (see docs/SCRUM/Feature.StartMPGame.md)
/// is sent or retargeted. Broadcast to the whole group rather than routed to
/// just the target — RoomStore has no PlayerId->connectionId reverse index
/// today, and clients simply ignore requests not addressed to them. Not a
/// privacy guarantee (a determined client could see it via devtools), just a
/// pragmatic simplification for a hobby project's trust model.
[<Literal>]
let PlayRequestReceivedEvent = "PlayRequestReceived"

/// Sent to the room when a play request is withdrawn — payload is just the
/// withdrawing sender's PlayerId, enough for clients to filter their local
/// list by FromPlayerId. Also sent from OnDisconnectedAsync (not just the
/// explicit WithdrawPlayRequest hub method) when a disconnecting player
/// was the SENDER of a still-pending request — see
/// Room.cancelPendingRequestsFor.
[<Literal>]
let PlayRequestWithdrawnEvent = "PlayRequestWithdrawn"

/// Sent to the room when the challenged player accepts a play request (see
/// docs/SCRUM/Feature.RequestToStartMPGame.md) — payload is the
/// (FromPlayerId, ToPlayerId) pair identifying which request, same
/// broadcast-to-whole-group tradeoff as PlayRequestReceived. Actually
/// starting a synced game isn't wired up yet; this just tells both clients
/// the request was resolved so they can update their UI (e.g. "Bob accepted
/// your challenge").
[<Literal>]
let PlayRequestAcceptedEvent = "PlayRequestAccepted"

/// Sent to the room when the challenged player denies a play request —
/// same payload shape as PlayRequestAccepted. Also sent from
/// OnDisconnectedAsync (not just the explicit DenyPlayRequest hub method)
/// when a disconnecting player was the TARGET of a still-pending
/// request — see Room.cancelPendingRequestsFor.
[<Literal>]
let PlayRequestDeniedEvent = "PlayRequestDenied"

/// Sent to the room's two active-game players once the final round of a
/// GameSession has been scored (game completed normally), or as soon as a
/// game ends early via forfeit (a player left/disconnected past the grace
/// period, or explicitly forfeited — see GameHub.ForfeitGame and
/// PlayerCleanupService). Payload: (Scores, PlayerA, PlayerB, Reason) — see
/// GameOverReason. Broadcast to the whole room group, same
/// broadcast-and-filter tradeoff as every other play-request/game event
/// here (see PlayRequestReceivedEvent's doc comment).
[<Literal>]
let GameOverEvent = "GameOver"

/// Sent to the room when a player is removed after being disconnected
/// longer than Room.disconnectGracePeriod (see PlayerCleanupService) —
/// payload is just their PlayerId, enough for clients to drop them from
/// their local roster/play-request lists the same way PlayRequestWithdrawn
/// is handled.
[<Literal>]
let PlayerLeftEvent = "PlayerLeft"

/// Sent to the room the instant a player's connection drops (tab closed,
/// network hiccup, refresh) — before the grace-period sweep decides
/// whether to remove them for good. Payload is just their PlayerId, so
/// clients can show a "disconnected" indicator (e.g. a dot) next to their
/// name in the players list without waiting for the full PlayerLeft
/// removal. A later reconnect creates a brand-new Player (there's no
/// resume-same-identity mechanism today), so there's no matching
/// "PlayerReconnected" — the old entry either gets swept via PlayerLeft or
/// the room simply gains a second, freshly-connected entry for the same
/// person under a new id.
[<Literal>]
let PlayerDisconnectedEvent = "PlayerDisconnected"

/// Chat messages are capped to keep a single overlong paste from bloating
/// every other client's message list; empty/whitespace-only messages are
/// dropped rather than broadcast.
let private maxChatMessageLength = 500

/// Picks a random verse REFERENCE (book/chapter/verseNumber — never text,
/// see VerseReference's doc comment) matching `gameType`'s restriction
/// from `verses` — the same Verse.matchesRestrictionByNumber +
/// Random.Shared.Next idiom /api/verses/random uses (see Program.fs), now
/// also needed server-side since the server (not the client) picks each
/// multiplayer round's verse. `verses` is the server's own pool — the
/// reference edition whose OWN book numbers everything is matched
/// against (see Verse.bookNumbers): `gameType`'s Books/Chapters carry
/// book numbers from the CHALLENGER's own source, matched here by number
/// (not name) against `verses`' own numbering, so a challenger's "Dommer"
/// and the server's "Dommerne" still match correctly. Each player's
/// client resolves the returned reference against their OWN chosen
/// VerseSource for the actual displayable text. None if nothing matches
/// (an empty/misconfigured book+chapter selection).
let private pickRandomVerse (verses: Verse list) (gameType: GameType) : VerseReference option =
    let numbersByBookName = Verse.bookNumbers verses
    let books, chaptersByBook = GameType.restrictionOf gameType
    let candidates = verses |> List.filter (Verse.matchesRestrictionByNumber numbersByBookName books chaptersByBook)

    if candidates.IsEmpty then
        None
    else
        Some(Verse.referenceOfIn numbersByBookName candidates[Random.Shared.Next(candidates.Length)])

/// What resolving a round actually decided to do — reported out of the
/// RoomStore.Update closure below via a mutable capture (see resolveRound)
/// so the caller knows which event(s) to broadcast, without resolveRound
/// itself acting on a `session` snapshot that might be stale by the time
/// it's used.
type private RoundResolution =
    /// The round wasn't actually ready to resolve — e.g. two
    /// near-simultaneous callers both thought "both players just
    /// guessed", but by the time this one's turn came under Update's
    /// retry loop, the round had already been resolved (Scored, or a
    /// fresh InProgress) by the other. No broadcast for this caller; the
    /// other caller's own resolveRound call already sent one.
    | NothingToResolve
    | GameCompleted of scored: GameSession
    | RoundAdvanced of scored: GameSession * advanced: GameSession

/// Scores the CURRENT round of the room at `roomCode`'s ActiveGame, then
/// either ends the game or advances to a freshly-picked verse, broadcasting
/// accordingly — shared by GameHub.SubmitGuess (both players guessed) and
/// RoundTimeoutService's sweep (deadline elapsed), so both paths use
/// identical resolve-then-advance-or-end logic. `group` is the room's
/// already-resolved IClientProxy (this.Clients.Group(roomCode) from a live
/// hub call, or hubContext.Clients.Group(roomCode) from the sweep) rather
/// than the whole Clients object, so this works from either caller without
/// depending on which (incompatible) IHubClients-family interface each one
/// actually implements.
///
/// The whole "is this round still the one I think it is, and if so, what
/// does resolving it produce" decision happens INSIDE one RoomStore.Update
/// call — reading the room fresh each attempt, not off a `session`
/// snapshot the caller already had lying around — so two near-simultaneous
/// resolves (both players' SubmitGuess landing close together, or
/// SubmitGuess racing RoundTimeoutService's sweep) can't each act on a
/// stale view and clobber each other's result. `f`'s own body is pure and
/// side-effect-free (safe for Update to retry under contention); it
/// reports what it decided via the `resolution` mutable capture, which
/// only reflects whichever attempt's write actually won — a retried
/// attempt overwrites it with that attempt's own (equally valid) decision,
/// and if the round turns out to already be resolved, it's left as
/// NothingToResolve and nothing is broadcast (the winning racer already
/// did).
let private resolveRound (group: IClientProxy) (verses: Verse list) (rooms: RoomStore) (roomCode: string) : Task =
    task {
        let mutable resolution = NothingToResolve

        rooms.Update(
            roomCode,
            fun room ->
                match room.ActiveGame with
                | None -> room
                | Some session ->
                    match session.Round with
                    | Scored _
                    | WaitingForPlayers -> room // already resolved by a winning racer — leave as-is
                    | InProgress _ ->
                        let scored = GameSession.scoreRound DateTimeOffset.UtcNow session

                        let endCompleted () =
                            resolution <- GameCompleted scored
                            Room.endGame (Room.updateGame (fun _ -> scored) room)

                        if GameSession.isOver scored then
                            endCompleted ()
                        else
                            match pickRandomVerse verses scored.GameType with
                            | None ->
                                // The book/chapter selection stopped
                                // matching anything (shouldn't normally
                                // happen — it matched at game start) — end
                                // the game rather than get stuck InProgress
                                // forever.
                                endCompleted ()
                            | Some nextVerse ->
                                let advanced = GameSession.advanceRound nextVerse DateTimeOffset.UtcNow scored
                                resolution <- RoundAdvanced(scored, advanced)
                                Room.updateGame (fun _ -> advanced) room
        )
        |> ignore

        match resolution with
        | NothingToResolve -> ()
        | GameCompleted scored ->
            do! group.SendAsync(RoundScoredEvent, scored)
            do! group.SendAsync(GameOverEvent, scored.GameId, scored.Scores, scored.PlayerA, scored.PlayerB, Completed)
        | RoundAdvanced(scored, advanced) ->
            do! group.SendAsync(RoundScoredEvent, scored)
            do! group.SendAsync(RoundStartedEvent, advanced)
    }

type GameHub(rooms: RoomStore, verses: Verse list) =
    inherit Hub()

    /// Adds the caller to `room` as a new player, registers the connection,
    /// broadcasts PlayerJoined, and sends the joiner (only) recent chat
    /// history — shared by JoinRoom and JoinWorldChat, which differ only in
    /// how they find/create the room to join. Returns the newly-created
    /// Player (via the invoke's return value) so the caller learns its own
    /// stable id — needed client-side to know which players-list entry is
    /// "me" (see chat-panel.ts's myPlayerId) and to target play requests.
    ///
    /// Enforces unique names within the room (see
    /// docs/SCRUM/Featue.UniquePlayerName.md) via Room.prepareJoin: fails
    /// outright (caller-only Error, no PlayerJoined) if `playerName` is
    /// already held by a currently-connected player. If it's held by a
    /// DISCONNECTED player instead, that stale entry is silently removed
    /// first (with the same PlayerLeft/GameOver broadcasts the periodic
    /// stale-disconnect sweep sends, so everyone else's roster/game state
    /// stays in sync) — this is what makes reconnecting under your own
    /// name work rather than being rejected as a duplicate.
    member private this.JoinExistingRoom(roomCode: string, playerName: string) : Task<Player> =
        task {
            let player =
                { Id = PlayerId(Guid.NewGuid())
                  Name = playerName
                  Score = 0 }

            // The whole "is this name actually free, and if a stale
            // disconnected player is being replaced, what was removed"
            // decision happens INSIDE one RoomStore.Update call — reading
            // the room fresh on every (possibly retried) attempt, not off
            // a snapshot the caller already had lying around — so a
            // concurrent join, disconnect, or game-ending event touching
            // the same room can't be silently discarded by this join's
            // write (see RoomStoreConcurrencyTests.fs).
            let mutable rejected = false
            let mutable removedStalePlayer: Player option = None
            let mutable forfeitedSession: GameSession option = None
            let mutable forfeitedOpponent: PlayerId option = None

            let updatedRoom =
                rooms.Update(
                    roomCode,
                    fun room ->
                        match Room.prepareJoin playerName room with
                        | Error() ->
                            rejected <- true
                            room
                        | Ok preparedRoom ->
                            rejected <- false

                            if preparedRoom.Players.Length < room.Players.Length then
                                let removed = room.Players |> List.find (fun p -> not (preparedRoom.Players |> List.contains p))
                                removedStalePlayer <- Some removed

                                match room.ActiveGame with
                                | Some session when session.PlayerA = removed.Id || session.PlayerB = removed.Id ->
                                    forfeitedSession <- Some session
                                    forfeitedOpponent <- Some(if session.PlayerA = removed.Id then session.PlayerB else session.PlayerA)
                                | _ ->
                                    forfeitedSession <- None
                                    forfeitedOpponent <- None
                            else
                                removedStalePlayer <- None
                                forfeitedSession <- None
                                forfeitedOpponent <- None

                            { preparedRoom with Players = player :: preparedRoom.Players }
                )

            match updatedRoom with
            | None ->
                do! this.Clients.Caller.SendAsync("Error", "Room not found")
                return failwith "Room not found"
            | Some _ when rejected ->
                do! this.Clients.Caller.SendAsync("Error", "That name is already taken in this room. Please choose another.")
                return failwith "Name already taken"
            | Some updated ->
                // A stale disconnected player of the same name was removed
                // to make room for this join — tell everyone else, exactly
                // like PlayerCleanupService's periodic sweep does.
                match removedStalePlayer with
                | Some removed ->
                    let (PlayerId removedGuid) = removed.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayerLeftEvent, string removedGuid)

                    match forfeitedSession with
                    | Some session ->
                        do!
                            this.Clients
                                .Group(roomCode)
                                .SendAsync(GameOverEvent, session.GameId, session.Scores, session.PlayerA, session.PlayerB, Forfeited forfeitedOpponent)
                    | None -> ()
                | None -> ()

                rooms.RegisterConnection(this.Context.ConnectionId, RoomCode roomCode, player)

                do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, roomCode)
                do! this.Clients.Group(roomCode).SendAsync(PlayerJoinedEvent, player)

                // RecentMessages is stored newest-first (see Room.addMessage);
                // reverse so the client receives/renders oldest-first.
                let history = updated.RecentMessages |> List.rev
                do! this.Clients.Caller.SendAsync(ChatHistoryEvent, history)

                // Full roster snapshot (including the joiner themself) so
                // players who joined earlier are visible right away, not
                // just future PlayerJoined broadcasts.
                do! this.Clients.Caller.SendAsync(RoomPlayersEvent, updated.Players)

                return player
        }

    member this.JoinRoom(roomCode: string, playerName: string) : Task<Player> =
        this.JoinExistingRoom(roomCode, playerName)

    /// Joins the always-open World chat room — just a name, no room code.
    member this.JoinWorldChat(playerName: string) : Task<Player> =
        let (RoomCode roomCode) = rooms.GetOrCreateWorldRoom().Code
        this.JoinExistingRoom(roomCode, playerName)

    member this.SendChatMessage(text: string) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, player) ->
                let trimmed = text.Trim()

                if trimmed = "" then
                    do! this.Clients.Caller.SendAsync("Error", "Message can't be empty")
                elif trimmed.Length > maxChatMessageLength then
                    do! this.Clients.Caller.SendAsync("Error", $"Message is too long (max {maxChatMessageLength} characters)")
                else
                    let message: ChatMessage =
                        { PlayerId = player.Id
                          PlayerName = player.Name
                          Text = trimmed
                          SentAt = DateTimeOffset.UtcNow }

                    // Record it into the room's history before broadcasting,
                    // so it's there for the next player who joins. Routed
                    // through Update (not TryGet+Set) so a concurrent
                    // message from another player in the same room can't
                    // be lost to a last-write-wins race.
                    rooms.Update(roomCode, Room.addMessage message) |> ignore

                    do! this.Clients.Group(roomCode).SendAsync(ChatMessageReceivedEvent, message)
        }

    /// Sends (or retargets — see Room.sendPlayRequest's REPLACE semantics)
    /// a play request from the caller to `toPlayerId`, for the `gameType`/
    /// `roundCount`/`timeLimitSeconds` the challenger chose beforehand (see
    /// docs/SCRUM/Feature.RequestToStartMPGame.md and
    /// docs/SCRUM/Feature.Time.md) — sent as-is to the whole room so the
    /// challenged player can see what they're being invited to.
    /// `timeLimitSeconds` is None (or 0) for "no limit" — translated to
    /// TimeLimit here rather than asking the client to construct a
    /// {Case:'Unlimited'}-shaped DU value by hand.
    member this.SendPlayRequest(toPlayerId: string, gameType: GameType, roundCount: int, timeLimitSeconds: int option) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, sender) ->
                match rooms.TryGet(roomCode) with
                | None -> do! this.Clients.Caller.SendAsync("Error", "Room not found")
                | Some room ->
                    let targetId = PlayerId(Guid.Parse toPlayerId)

                    match room.Players |> List.tryFind (fun p -> p.Id = targetId) with
                    | None -> do! this.Clients.Caller.SendAsync("Error", "That player is no longer in the room")
                    | Some _ when Room.isInActiveGame sender.Id room ->
                        do! this.Clients.Caller.SendAsync("Error", "You can't send a play request while a game is in progress")
                    | Some _ when Room.isInActiveGame targetId room ->
                        do! this.Clients.Caller.SendAsync("Error", "That player is already in a game")
                    | Some _ ->
                        let timeLimit =
                            match timeLimitSeconds with
                            | None | Some 0 -> Unlimited
                            | Some seconds -> LimitedTo(TimeSpan.FromSeconds(float seconds))

                        let request =
                            { FromPlayerId = sender.Id
                              FromPlayerName = sender.Name
                              ToPlayerId = targetId
                              GameType = gameType
                              RoundCount = roundCount
                              RoundTimeLimit = timeLimit
                              SentAt = DateTimeOffset.UtcNow }

                        rooms.Update(roomCode, Room.sendPlayRequest request) |> ignore
                        do! this.Clients.Group(roomCode).SendAsync(PlayRequestReceivedEvent, request)
        }

    /// Withdraws whatever play request the caller currently has pending, if
    /// any. A no-op (no error) if they don't have one — mirrors the
    /// forgiving REPLACE semantics of SendPlayRequest.
    member this.WithdrawPlayRequest() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, sender) ->
                match rooms.Update(roomCode, Room.withdrawPlayRequest sender.Id) with
                | None -> ()
                | Some _ ->
                    let (PlayerId senderGuid) = sender.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayRequestWithdrawnEvent, string senderGuid)
        }

    /// Accepts the pending request from `fromPlayerId` to the caller —
    /// resolves the request AND starts the game it described: picks the
    /// first verse (impure — Random, via pickRandomVerse, same idiom as
    /// /api/verses/random), then broadcasts PlayRequestAccepted (unchanged,
    /// for "they accepted" UI feedback) immediately followed by
    /// RoundStarted (new) carrying the full GameSession. A no-op (no
    /// broadcast at all) if the request was no longer there (e.g.
    /// withdrawn a moment earlier) — naturally means "if it's gone, no
    /// game starts", no separate guard needed for that race. Guarded by
    /// the one-active-game-per-player rule: refuses (caller-only Error) if
    /// either player already has a game running.
    member this.AcceptPlayRequest(fromPlayerId: string) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, toPlayer) ->
                let fromId = PlayerId(Guid.Parse fromPlayerId)

                // The whole "are both players actually still free, is the
                // request still there, and (if so) starting the game with
                // a freshly-picked verse" decision happens INSIDE one
                // RoomStore.Update call — reading the room fresh on every
                // (possibly retried) attempt, not off a snapshot taken
                // before this method's own guard checks — so a
                // concurrently-starting/ending game or withdrawn request
                // can't be missed (see RoomStoreConcurrencyTests.fs).
                let mutable outcome = Error "You haven't joined a room" // overwritten below on every real path

                // Minted OUT here, not inside the Update closure below:
                // that closure is retried on contention (see RoomStore),
                // so generating the id inside would mint a different one
                // per attempt. One accepted request = one game = one id.
                let gameId = GameId(Guid.NewGuid())

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            if Room.isInActiveGame fromId room || Room.isInActiveGame toPlayer.Id room then
                                outcome <- Error "You or that player already have a game in progress"
                                room
                            else
                                match room.PendingRequests |> List.tryFind (fun r -> r.FromPlayerId = fromId && r.ToPlayerId = toPlayer.Id) with
                                | None ->
                                    outcome <- Ok None
                                    room
                                | Some request ->
                                    match pickRandomVerse verses request.GameType with
                                    | None ->
                                        outcome <- Error "No verses match that game's book/chapter selection"
                                        room
                                    | Some firstVerse ->
                                        let updated, accepted =
                                            Room.acceptPlayRequest gameId fromId toPlayer.Id firstVerse DateTimeOffset.UtcNow room

                                        outcome <- Ok accepted
                                        updated
                    )

                match outcome with
                | Error message -> do! this.Clients.Caller.SendAsync("Error", message)
                | Ok None -> () // request already gone (withdrawn/retargeted) — no-op, matches the old behavior
                | Ok(Some _) ->
                    let (PlayerId fromGuid) = fromId
                    let (PlayerId toGuid) = toPlayer.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayRequestAcceptedEvent, string fromGuid, string toGuid)

                    match updatedRoom |> Option.bind (fun r -> r.ActiveGame) with
                    | Some session -> do! this.Clients.Group(roomCode).SendAsync(RoundStartedEvent, session)
                    | None -> ()
        }

    /// Denies the pending request from `fromPlayerId` to the caller —
    /// resolves (removes) the request without starting anything. A no-op
    /// (no error) if that request is no longer there, same forgiving
    /// pattern as WithdrawPlayRequest.
    member this.DenyPlayRequest(fromPlayerId: string) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, toPlayer) ->
                let fromId = PlayerId(Guid.Parse fromPlayerId)

                match rooms.Update(roomCode, Room.denyPlayRequest fromId toPlayer.Id) with
                | None -> ()
                | Some _ ->
                    let (PlayerId fromGuid) = fromId
                    let (PlayerId toGuid) = toPlayer.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayRequestDeniedEvent, string fromGuid, string toGuid)
        }

    /// Submits the caller's guess for the current round of their active
    /// game. `bookNumber` is the guessed book's 1-based position in the
    /// CALLER'S OWN VerseSource's Bible order (see
    /// frontend/src/game-type.ts) — None if their own source couldn't
    /// resolve one for what they typed, in which case scoring falls back
    /// to name matching (see Scoring.isCorrectGuess). Errors (caller-only,
    /// no broadcast) if the caller isn't in a room, isn't in an active
    /// game, or the game's current round isn't InProgress (e.g. a late
    /// resubmit racing the round already resolving). On success: records
    /// the guess, and — if this completes both players' guesses for the
    /// round — resolves it (see resolveRound). No broadcast on an
    /// individual submission; the round only announces itself once
    /// resolved (via RoundScored/RoundStarted/GameOver).
    member this.SubmitGuess(book: string, bookNumber: int option, chapter: int option, verseNumber: int option) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, player) ->
                let guess: Guess =
                    { PlayerId = player.Id
                      Book = book
                      BookNumber = bookNumber
                      Chapter = chapter
                      VerseNumber = verseNumber
                      SubmittedAt = DateTimeOffset.UtcNow }

                // Records the guess and decides whether it completed both
                // players' guesses for the round, all inside one
                // RoomStore.Update call — reading ActiveGame fresh on
                // every (possibly retried) attempt rather than off a
                // separately-read snapshot, so a guess recorded by a
                // concurrent SubmitGuess from the other player can never
                // be silently overwritten by this one (see
                // RoomStoreConcurrencyTests.fs for the bug this fixes).
                // The three error cases below are re-checked fresh inside
                // the closure too, for the same reason — not just for the
                // initial read.
                let mutable outcome = Error "You don't have an active game"

                rooms.Update(
                    roomCode,
                    fun room ->
                        match room.ActiveGame with
                        | Some session when session.PlayerA = player.Id || session.PlayerB = player.Id ->
                            match session.Round with
                            | Scored _
                            | WaitingForPlayers ->
                                outcome <- Error "This round is no longer accepting guesses"
                                room
                            | InProgress _ ->
                                let withGuess = Room.updateGame (GameSession.submitGuess player.Id guess) room

                                outcome <-
                                    match withGuess.ActiveGame with
                                    | Some updated when GameSession.bothGuessed updated -> Ok true
                                    | _ -> Ok false

                                withGuess
                        | _ -> room // outcome stays the initial "no active game" error
                )
                |> ignore

                match outcome with
                | Error message -> do! this.Clients.Caller.SendAsync("Error", message)
                | Ok true -> do! resolveRound (this.Clients.Group(roomCode)) verses rooms roomCode
                | Ok false -> ()
        }

    /// The caller forfeits their active game, if they have one — ends the
    /// game (Room.forfeitGame) and broadcasts GameOver(Forfeited) naming
    /// the opponent as the surviving player. A no-op (no error) if the
    /// caller doesn't have an active game — mirrors WithdrawPlayRequest's
    /// forgiving semantics.
    member this.ForfeitGame() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, player) ->
                // Captures the session being forfeited (if any) from
                // INSIDE the atomic update, not a separately-read
                // snapshot, so it's always the one actually forfeited by
                // this call — not a stale view that could disagree with
                // what Room.forfeitGame just did.
                let mutable forfeitedSession: GameSession option = None

                rooms.Update(
                    roomCode,
                    fun room ->
                        match room.ActiveGame with
                        | Some session when session.PlayerA = player.Id || session.PlayerB = player.Id ->
                            forfeitedSession <- Some session
                            Room.forfeitGame player.Id room
                        | _ ->
                            forfeitedSession <- None
                            room
                )
                |> ignore

                match forfeitedSession with
                | Some session ->
                    let opponent = if session.PlayerA = player.Id then session.PlayerB else session.PlayerA
                    do! this.Clients.Group(roomCode).SendAsync(GameOverEvent, session.GameId, session.Scores, session.PlayerA, session.PlayerB, Forfeited(Some opponent))
                | None -> ()
        }

    /// The caller voluntarily leaves the room (clicking "← Home" or "Back
    /// to chat selection") — see Room.leave's doc comment for why this
    /// exists at all: the underlying SignalR connection is a page-lifetime
    /// singleton that's never stopped on navigation, so without a real
    /// "I'm leaving" signal to the server, a player who left via the UI
    /// stayed fully "connected" server-side indefinitely — long enough to
    /// make Room.prepareJoin correctly (but unhelpfully) reject their own
    /// attempt to come back into the room under the same name. Removes
    /// the caller immediately (no grace period, unlike a dropped
    /// connection) and broadcasts PlayerLeft/GameOver(Forfeited) the same
    /// way the other removal paths (stale-disconnect sweep, prepareJoin's
    /// same-name replacement) do. A no-op if the caller isn't in a room
    /// (nothing to leave) — mirrors WithdrawPlayRequest/ForfeitGame's
    /// forgiving semantics; deliberately does NOT drop the connection
    /// itself (RegisterConnection stays as-is), since the same connection
    /// may go on to join a different room next.
    member this.LeaveRoom() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> ()
            | Some(RoomCode roomCode, player) ->
                // Captures the session being forfeited (if any) from
                // INSIDE the atomic update, same as ForfeitGame above —
                // Room.leave's own opponent-id result isn't enough on its
                // own to broadcast a real GameOver with actual final
                // scores, so the pre-removal session is captured here too.
                let mutable forfeitedSession: GameSession option = None

                rooms.Update(
                    roomCode,
                    fun room ->
                        forfeitedSession <-
                            room.ActiveGame
                            |> Option.filter (fun s -> s.PlayerA = player.Id || s.PlayerB = player.Id)

                        let updated, _ = Room.leave player.Id room
                        updated
                )
                |> ignore

                let (PlayerId playerGuid) = player.Id
                do! this.Clients.Group(roomCode).SendAsync(PlayerLeftEvent, string playerGuid)

                match forfeitedSession with
                | Some session ->
                    let opponent = if session.PlayerA = player.Id then session.PlayerB else session.PlayerA
                    do! this.Clients.Group(roomCode).SendAsync(GameOverEvent, session.GameId, session.Scores, session.PlayerA, session.PlayerB, Forfeited(Some opponent))
                | None -> ()
        }

    /// Marks the disconnecting player as disconnected (still visible in the
    /// room, just flagged) rather than removing them immediately — a page
    /// refresh or brief network drop shouldn't make someone vanish from
    /// the roster. PlayerCleanupService's periodic sweep is what actually
    /// removes them, once they've been gone longer than
    /// Room.disconnectGracePeriod. Also immediately cancels any pending
    /// invitation involving them — see
    /// docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md and
    /// Room.cancelPendingRequestsFor's own doc comment — broadcasting
    /// PlayRequestWithdrawn (they were the sender) or PlayRequestDenied
    /// (they were the target) per cancelled request, the exact same
    /// events/payload shapes WithdrawPlayRequest/DenyPlayRequest already
    /// send for an explicit withdraw/deny, so the frontend needs no new
    /// handling at all.
    // Not calling base.OnDisconnectedAsync here — Hub's default
    // implementation is Task.CompletedTask (a no-op), and F# doesn't allow
    // a `base` call inside a computation expression (only directly in a
    // member body), which a `task { }` here would require.
    override this.OnDisconnectedAsync(exn: exn) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> ()
            | Some(RoomCode roomCode, player) ->
                rooms.RemoveConnection(this.Context.ConnectionId)

                // markDisconnected AND cancelPendingRequestsFor happen
                // inside ONE atomic rooms.Update call, not two separate
                // ones — a second, separate Update would reopen a race
                // window (e.g. AcceptPlayRequest landing between "marked
                // disconnected" and "requests cancelled") of exactly the
                // kind rooms.Update itself exists to close. See
                // RoomStoreConcurrencyTests.fs.
                let mutable cancelledRequests: PlayRequest list = []

                match
                    rooms.Update(
                        roomCode,
                        fun room ->
                            let disconnected = Room.markDisconnected player.Id DateTimeOffset.UtcNow room
                            let updated, cancelled = Room.cancelPendingRequestsFor player.Id disconnected
                            cancelledRequests <- cancelled
                            updated
                    )
                with
                | None -> ()
                | Some _ ->
                    let (PlayerId playerGuid) = player.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayerDisconnectedEvent, string playerGuid)

                    for request in cancelledRequests do
                        let (PlayerId fromGuid) = request.FromPlayerId
                        let (PlayerId toGuid) = request.ToPlayerId

                        if request.FromPlayerId = player.Id then
                            do! this.Clients.Group(roomCode).SendAsync(PlayRequestWithdrawnEvent, string fromGuid)
                        else
                            do! this.Clients.Group(roomCode).SendAsync(PlayRequestDeniedEvent, string fromGuid, string toGuid)
        }

/// How long a disconnected player stays in the room, and how often
/// PlayerCleanupService checks, before removing them for good — see that
/// type's own doc comment. Configurable via
/// "Presence:DisconnectGracePeriodSeconds"/"Presence:SweepIntervalSeconds"
/// (see Program.fs), each defaulting to this type's own previous
/// hardcoded values when unset — primarily so tests (backend integration
/// tests, or a future e2e test) can dial BOTH down to seconds instead of
/// waiting out the real 2-minute grace period on a 30-second sweep,
/// without needing to touch production code or its defaults.
type PresenceSettings =
    { DisconnectGracePeriod: TimeSpan
      SweepInterval: TimeSpan }

/// Periodically sweeps every room for players who disconnected more than
/// `settings.DisconnectGracePeriod` ago and removes them for good,
/// broadcasting PlayerLeft (and cleaning up their play requests — see
/// Room.removeStaleDisconnections) so every other client's roster drops
/// them without needing to wait for their own next RoomPlayers snapshot.
/// If a removed player was mid-game, their ActiveGame is forfeited too
/// (see removeStaleDisconnections) — this sweep broadcasts GameOver
/// (Forfeited) to notify the surviving opponent, same "auto-forfeit after
/// the disconnect grace period" behavior as everywhere else disconnection
/// is handled in this app.
type PlayerCleanupService(rooms: RoomStore, hubContext: IHubContext<GameHub>, settings: PresenceSettings) =
    inherit Microsoft.Extensions.Hosting.BackgroundService()

    override _.ExecuteAsync(stoppingToken: Threading.CancellationToken) : Task =
        task {
            while not stoppingToken.IsCancellationRequested do
                let cutoff = DateTimeOffset.UtcNow - settings.DisconnectGracePeriod

                // rooms.AllRooms() below is only used to enumerate WHICH
                // room codes to sweep — the actual removal decision for
                // each one happens fresh inside its own Update call, so a
                // room mutated by a live hub call between this snapshot
                // and the sweep reaching it is still handled correctly
                // (see RoomStoreConcurrencyTests.fs).
                // Each room swept inside its own try/with — see the same
                // guard in RoundTimeoutService below for the full rationale.
                // It matters at least as much here: these broadcasts go out
                // right after players dropped, so a throwing SendAsync is
                // squarely in the expected path, and unguarded it would
                // silently kill presence sweeping process-wide.
                for room in rooms.AllRooms() do
                    let (RoomCode roomCode) = room.Code
                    let mutable removedIds: PlayerId list = []
                    let mutable forfeitedGame: GameSession option = None
                    let mutable forfeitedOpponent: PlayerId option = None

                    try
                        rooms.Update(
                            roomCode,
                            fun current ->
                                forfeitedGame <- current.ActiveGame
                                let updated, removed, opponent = Room.removeStaleDisconnections cutoff current
                                removedIds <- removed
                                forfeitedOpponent <- opponent
                                updated
                        )
                        |> ignore

                        if not removedIds.IsEmpty then
                            for PlayerId removedGuid in removedIds do
                                do! hubContext.Clients.Group(roomCode).SendAsync(PlayerLeftEvent, string removedGuid)

                            match forfeitedGame with
                            | Some session ->
                                do!
                                    hubContext.Clients
                                        .Group(roomCode)
                                        .SendAsync(GameOverEvent, session.GameId, session.Scores, session.PlayerA, session.PlayerB, Forfeited forfeitedOpponent)
                            | None -> ()
                    with ex ->
                        eprintfn "[PlayerCleanupService] failed to sweep room %s: %O" roomCode ex

                try
                    do! Task.Delay(settings.SweepInterval, stoppingToken)
                with :? OperationCanceledException ->
                    ()
        }

/// How often RoundTimeoutService checks for an expired round — see that
/// type's own doc comment. Configurable via
/// "RoundTimeout:SweepIntervalSeconds" (see Program.fs), defaulting to
/// 1 second when unset — same "let a test dial this down" motivation as
/// PresenceSettings, kept as its own separate settings type rather than
/// folded into PresenceSettings since it's a genuinely different concern
/// (round timing, not player presence) with its own default.
type RoundTimeoutSettings = { SweepInterval: TimeSpan }

/// Periodically sweeps every room's ActiveGame for a round whose time
/// limit has elapsed and auto-resolves it (scores whoever guessed,
/// implicit 0 for whoever didn't, then advances/ends the game) — mirrors
/// PlayerCleanupService's sweep-and-broadcast-via-IHubContext pattern
/// exactly, since this is the same shape of problem: something server-
/// initiated that isn't triggered by any client call. A 1-second default
/// interval (vs. PlayerCleanupService's 30s) so a short round timer still
/// feels responsive — still trivially cheap for what's normally a
/// handful of in-memory rooms. Self-healing against races with
/// SubmitGuess resolving the same round moments earlier:
/// GameSession.isRoundExpired only matches a round that's still
/// InProgress, so a round SubmitGuess already advanced/scored is simply
/// skipped on the next tick — no cancellation or locking needed,
/// consistent with RoomStore's atomic ConcurrentDictionary.Set.
type RoundTimeoutService(rooms: RoomStore, verses: Verse list, hubContext: IHubContext<GameHub>, settings: RoundTimeoutSettings) =
    inherit Microsoft.Extensions.Hosting.BackgroundService()

    override _.ExecuteAsync(stoppingToken: Threading.CancellationToken) : Task =
        task {
            while not stoppingToken.IsCancellationRequested do
                let now = DateTimeOffset.UtcNow

                // Each room is swept inside its own try/with: resolveRound
                // ends in group.SendAsync, which can genuinely throw (a
                // client disconnecting mid-broadcast, a transport fault).
                // Unguarded, one such throw escapes ExecuteAsync, ends the
                // while loop and silently kills this BackgroundService for
                // the lifetime of the process — after which NO room's round
                // ever times out again, so every game everywhere sticks at
                // 0s until the server restarts. A single failing room must
                // only cost that room this tick; it'll be retried on the
                // next one.
                for room in rooms.AllRooms() do
                    let (RoomCode roomCode) = room.Code

                    try
                        match room.ActiveGame with
                        | Some session when GameSession.isRoundExpired now session ->
                            do! resolveRound (hubContext.Clients.Group(roomCode)) verses rooms roomCode
                        | _ -> ()
                    with ex ->
                        eprintfn "[RoundTimeoutService] failed to resolve round for room %s: %O" roomCode ex

                try
                    do! Task.Delay(settings.SweepInterval, stoppingToken)
                with :? OperationCanceledException ->
                    ()
        }
