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

    member _.Set(code: string, room: Room) = rooms[code] <- room

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
/// list by FromPlayerId.
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
/// same payload shape as PlayRequestAccepted.
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

/// Scores the current round of `session` in the room at `roomCode`,
/// broadcasts RoundScored, then either ends the game (broadcasting
/// GameOver) or advances to a freshly-picked verse (broadcasting
/// RoundStarted) — shared by GameHub.SubmitGuess (both players guessed)
/// and RoundTimeoutService's sweep (deadline elapsed), so both paths use
/// identical resolve-then-advance-or-end logic. `group` is the room's
/// already-resolved IClientProxy (this.Clients.Group(roomCode) from a live
/// hub call, or hubContext.Clients.Group(roomCode) from the sweep) rather
/// than the whole Clients object, so this works from either caller without
/// depending on which (incompatible) IHubClients-family interface each one
/// actually implements.
let private resolveRound
    (group: IClientProxy)
    (verses: Verse list)
    (rooms: RoomStore)
    (roomCode: string)
    (room: Room)
    (session: GameSession)
    : Task =
    task {
        let scored = GameSession.scoreRound DateTimeOffset.UtcNow session
        let roomAfterScoring = Room.updateGame (fun _ -> scored) room
        rooms.Set(roomCode, roomAfterScoring)
        do! group.SendAsync(RoundScoredEvent, scored)

        let endWithCompleted () =
            let roomAfterEnd = Room.endGame roomAfterScoring
            rooms.Set(roomCode, roomAfterEnd)
            group.SendAsync(GameOverEvent, scored.Scores, scored.PlayerA, scored.PlayerB, Completed)

        if GameSession.isOver scored then
            do! endWithCompleted ()
        else
            match pickRandomVerse verses scored.GameType with
            | None ->
                // The book/chapter selection stopped matching anything
                // (shouldn't normally happen — it matched at game start)
                // — end the game rather than get stuck InProgress forever.
                do! endWithCompleted ()
            | Some nextVerse ->
                let advanced = GameSession.advanceRound nextVerse DateTimeOffset.UtcNow scored
                let roomAfterAdvance = Room.updateGame (fun _ -> advanced) roomAfterScoring
                rooms.Set(roomCode, roomAfterAdvance)
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
    member private this.JoinExistingRoom(room: Room, playerName: string) : Task<Player> =
        task {
            let (RoomCode roomCode) = room.Code

            let player =
                { Id = PlayerId(Guid.NewGuid())
                  Name = playerName
                  Score = 0 }

            let updated = { room with Players = player :: room.Players }
            rooms.Set(roomCode, updated)
            rooms.RegisterConnection(this.Context.ConnectionId, room.Code, player)

            do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, roomCode)
            do! this.Clients.Group(roomCode).SendAsync(PlayerJoinedEvent, player)

            // RecentMessages is stored newest-first (see Room.addMessage);
            // reverse so the client receives/renders oldest-first.
            let history = room.RecentMessages |> List.rev
            do! this.Clients.Caller.SendAsync(ChatHistoryEvent, history)

            // Full roster snapshot (including the joiner themself) so
            // players who joined earlier are visible right away, not just
            // future PlayerJoined broadcasts.
            do! this.Clients.Caller.SendAsync(RoomPlayersEvent, updated.Players)

            return player
        }

    member this.JoinRoom(roomCode: string, playerName: string) : Task<Player> =
        task {
            match rooms.TryGet(roomCode) with
            | None ->
                do! this.Clients.Caller.SendAsync("Error", "Room not found")
                return failwith "Room not found"
            | Some room -> return! this.JoinExistingRoom(room, playerName)
        }

    /// Joins the always-open World chat room — just a name, no room code.
    member this.JoinWorldChat(playerName: string) : Task<Player> =
        this.JoinExistingRoom(rooms.GetOrCreateWorldRoom(), playerName)

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
                    // so it's there for the next player who joins.
                    match rooms.TryGet(roomCode) with
                    | Some room -> rooms.Set(roomCode, Room.addMessage message room)
                    | None -> ()

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

                        rooms.Set(roomCode, Room.sendPlayRequest request room)
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
                match rooms.TryGet(roomCode) with
                | None -> ()
                | Some room ->
                    rooms.Set(roomCode, Room.withdrawPlayRequest sender.Id room)
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
                match rooms.TryGet(roomCode) with
                | None -> ()
                | Some room ->
                    let fromId = PlayerId(Guid.Parse fromPlayerId)

                    if Room.isInActiveGame fromId room || Room.isInActiveGame toPlayer.Id room then
                        do! this.Clients.Caller.SendAsync("Error", "You or that player already have a game in progress")
                    else
                        match room.PendingRequests |> List.tryFind (fun r -> r.FromPlayerId = fromId && r.ToPlayerId = toPlayer.Id) with
                        | None -> ()
                        | Some request ->
                            match pickRandomVerse verses request.GameType with
                            | None ->
                                do! this.Clients.Caller.SendAsync(
                                        "Error",
                                        "No verses match that game's book/chapter selection"
                                    )
                            | Some firstVerse ->
                                let updated, accepted =
                                    Room.acceptPlayRequest fromId toPlayer.Id firstVerse DateTimeOffset.UtcNow room

                                rooms.Set(roomCode, updated)

                                match accepted with
                                | None -> ()
                                | Some _ ->
                                    let (PlayerId fromGuid) = fromId
                                    let (PlayerId toGuid) = toPlayer.Id
                                    do! this.Clients.Group(roomCode).SendAsync(PlayRequestAcceptedEvent, string fromGuid, string toGuid)

                                    match updated.ActiveGame with
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
                match rooms.TryGet(roomCode) with
                | None -> ()
                | Some room ->
                    let fromId = PlayerId(Guid.Parse fromPlayerId)
                    rooms.Set(roomCode, Room.denyPlayRequest fromId toPlayer.Id room)
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
                match rooms.TryGet(roomCode) with
                | None -> do! this.Clients.Caller.SendAsync("Error", "Room not found")
                | Some room ->
                    match room.ActiveGame with
                    | Some session when session.PlayerA = player.Id || session.PlayerB = player.Id ->
                        match session.Round with
                        | Scored _
                        | WaitingForPlayers ->
                            do! this.Clients.Caller.SendAsync("Error", "This round is no longer accepting guesses")
                        | InProgress _ ->
                            let guess: Guess =
                                { PlayerId = player.Id
                                  Book = book
                                  BookNumber = bookNumber
                                  Chapter = chapter
                                  VerseNumber = verseNumber
                                  SubmittedAt = DateTimeOffset.UtcNow }

                            let withGuess = Room.updateGame (GameSession.submitGuess player.Id guess) room
                            rooms.Set(roomCode, withGuess)

                            match withGuess.ActiveGame with
                            | Some updatedSession when GameSession.bothGuessed updatedSession ->
                                do! resolveRound (this.Clients.Group(roomCode)) verses rooms roomCode withGuess updatedSession
                            | _ -> ()
                    | _ -> do! this.Clients.Caller.SendAsync("Error", "You don't have an active game")
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
                match rooms.TryGet(roomCode) with
                | None -> ()
                | Some room ->
                    match room.ActiveGame with
                    | Some session when session.PlayerA = player.Id || session.PlayerB = player.Id ->
                        let opponent = if session.PlayerA = player.Id then session.PlayerB else session.PlayerA
                        let updated = Room.forfeitGame player.Id room
                        rooms.Set(roomCode, updated)
                        do! this.Clients.Group(roomCode).SendAsync(GameOverEvent, session.Scores, session.PlayerA, session.PlayerB, Forfeited(Some opponent))
                    | _ -> ()
        }

    /// Marks the disconnecting player as disconnected (still visible in the
    /// room, just flagged) rather than removing them immediately — a page
    /// refresh or brief network drop shouldn't make someone vanish from
    /// the roster. PlayerCleanupService's periodic sweep is what actually
    /// removes them, once they've been gone longer than
    /// Room.disconnectGracePeriod.
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

                match rooms.TryGet(roomCode) with
                | None -> ()
                | Some room ->
                    rooms.Set(roomCode, Room.markDisconnected player.Id DateTimeOffset.UtcNow room)
                    let (PlayerId playerGuid) = player.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayerDisconnectedEvent, string playerGuid)
        }

/// Periodically sweeps every room for players who disconnected more than
/// Room.disconnectGracePeriod ago and removes them for good, broadcasting
/// PlayerLeft (and cleaning up their play requests — see
/// Room.removeStaleDisconnections) so every other client's roster drops
/// them without needing to wait for their own next RoomPlayers snapshot.
/// If a removed player was mid-game, their ActiveGame is forfeited too
/// (see removeStaleDisconnections) — this sweep broadcasts GameOver
/// (Forfeited) to notify the surviving opponent, same "auto-forfeit after
/// the disconnect grace period" behavior as everywhere else disconnection
/// is handled in this app.
type PlayerCleanupService(rooms: RoomStore, hubContext: IHubContext<GameHub>) =
    inherit Microsoft.Extensions.Hosting.BackgroundService()

    /// How often to sweep — frequent enough that a removal shows up
    /// promptly once the grace period elapses, without being wasteful for
    /// what's normally a small, in-memory room list.
    let sweepInterval = TimeSpan.FromSeconds 30.0

    override _.ExecuteAsync(stoppingToken: Threading.CancellationToken) : Task =
        task {
            while not stoppingToken.IsCancellationRequested do
                let cutoff = DateTimeOffset.UtcNow - Room.disconnectGracePeriod

                for room in rooms.AllRooms() do
                    let (RoomCode roomCode) = room.Code
                    let forfeitedGame = room.ActiveGame
                    let updated, removedIds, forfeitedOpponent = Room.removeStaleDisconnections cutoff room

                    if not removedIds.IsEmpty then
                        rooms.Set(roomCode, updated)

                        for PlayerId removedGuid in removedIds do
                            do! hubContext.Clients.Group(roomCode).SendAsync(PlayerLeftEvent, string removedGuid)

                        match forfeitedGame with
                        | Some session ->
                            do!
                                hubContext.Clients
                                    .Group(roomCode)
                                    .SendAsync(GameOverEvent, session.Scores, session.PlayerA, session.PlayerB, Forfeited forfeitedOpponent)
                        | None -> ()

                try
                    do! Task.Delay(sweepInterval, stoppingToken)
                with :? OperationCanceledException ->
                    ()
        }

/// Periodically sweeps every room's ActiveGame for a round whose time
/// limit has elapsed and auto-resolves it (scores whoever guessed,
/// implicit 0 for whoever didn't, then advances/ends the game) — mirrors
/// PlayerCleanupService's sweep-and-broadcast-via-IHubContext pattern
/// exactly, since this is the same shape of problem: something server-
/// initiated that isn't triggered by any client call. A 1-second interval
/// (vs. PlayerCleanupService's 30s) so a short round timer still feels
/// responsive — still trivially cheap for what's normally a handful of
/// in-memory rooms. Self-healing against races with SubmitGuess resolving
/// the same round moments earlier: GameSession.isRoundExpired only matches
/// a round that's still InProgress, so a round SubmitGuess already
/// advanced/scored is simply skipped on the next tick — no cancellation
/// or locking needed, consistent with RoomStore's atomic ConcurrentDictionary.Set.
type RoundTimeoutService(rooms: RoomStore, verses: Verse list, hubContext: IHubContext<GameHub>) =
    inherit Microsoft.Extensions.Hosting.BackgroundService()

    let sweepInterval = TimeSpan.FromSeconds 1.0

    override _.ExecuteAsync(stoppingToken: Threading.CancellationToken) : Task =
        task {
            while not stoppingToken.IsCancellationRequested do
                let now = DateTimeOffset.UtcNow

                for room in rooms.AllRooms() do
                    let (RoomCode roomCode) = room.Code

                    match room.ActiveGame with
                    | Some session when GameSession.isRoundExpired now session ->
                        do! resolveRound (hubContext.Clients.Group(roomCode)) verses rooms roomCode room session
                    | _ -> ()

                try
                    do! Task.Delay(sweepInterval, stoppingToken)
                with :? OperationCanceledException ->
                    ()
        }
