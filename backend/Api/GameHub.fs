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
/// Room.cancelPendingRequestsFor — and when opening a Congregation drops
/// every pending request in the room.
[<Literal>]
let PlayRequestWithdrawnEvent = "PlayRequestWithdrawn"

/// Sent to the room when the challenged player accepts a play request (see
/// docs/SCRUM/Feature.RequestToStartMPGame.md) — payload is the
/// (FromPlayerId, ToPlayerId) pair identifying which request, same
/// broadcast-to-whole-group tradeoff as PlayRequestReceived. Followed by
/// RoundStarted for the game the request started.
[<Literal>]
let PlayRequestAcceptedEvent = "PlayRequestAccepted"

/// Sent to the caller when they join the matchmaking queue and nobody is
/// waiting yet — see
/// docs/SCRUM/TODO/Feature.StartMulitplayerGameWaitForRandomPlayer.md.
/// The game itself starts later, via the usual RoundStarted, once someone
/// else asks to be matched.
[<Literal>]
let WaitingForMatchEvent = "WaitingForMatch"

/// Sent to the caller when they stop waiting without being matched — and
/// to the whole room when opening a Congregation empties the queue.
[<Literal>]
let MatchmakingCancelledEvent = "MatchmakingCancelled"

/// Sent to the room when the challenged player denies a play request —
/// same payload shape as PlayRequestAccepted. Also sent from
/// OnDisconnectedAsync (not just the explicit DenyPlayRequest hub method)
/// when a disconnecting player was the TARGET of a still-pending
/// request — see Room.cancelPendingRequestsFor.
[<Literal>]
let PlayRequestDeniedEvent = "PlayRequestDenied"

/// Sent to the room once the final round of a GameSession has been scored
/// (game completed normally), or as soon as a game ends early: a duel via
/// forfeit (a player left/disconnected past the grace period, or
/// explicitly forfeited — see GameHub.ForfeitGame and
/// PlayerCleanupService), a Congregation when its last participant left.
/// Payload: (GameId, Scores, Participants, Reason) — see GameOverReason.
/// Broadcast to the whole room group, same broadcast-and-filter tradeoff
/// as every other play-request/game event here (see
/// PlayRequestReceivedEvent's doc comment).
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

/// Sent to the room whenever what the room is doing changes — a duel
/// starts or ends, a Congregation lobby opens, changes, starts or closes —
/// and to a player right after they join. Payload: a RoomActivityView.
/// This is how every client knows whether it may challenge someone, open
/// a lobby, or should show the Congregation instead.
[<Literal>]
let RoomActivityChangedEvent = "RoomActivityChanged"

/// The Congregation leaderboard (a LeaderboardSnapshot), sent to the room
/// AND to its spectators whenever it changes. The only event spectators
/// ever receive — see WatchRoom.
[<Literal>]
let LeaderboardUpdatedEvent = "LeaderboardUpdated"

/// Spectators of a room join their own SignalR group, never the room's:
/// the room group receives RoundStarted, which carries the verse reference
/// of the round being guessed (players need it to show the verse), and
/// the spectator board must not reveal that before the round is scored.
[<Literal>]
let SpectatorGroupSuffix = ":spectators"

/// Room codes are 4 digits or WORLD, so this can never collide with a
/// room's own group name.
let spectatorGroupOf (roomCode: string) = roomCode + SpectatorGroupSuffix

/// Chat messages are capped to keep a single overlong paste from bloating
/// every other client's message list; empty/whitespace-only messages are
/// dropped rather than broadcast.
let private maxChatMessageLength = 500

/// What a room is doing, as its players see it — RoomActivity minus the
/// duels' round state, which only the two players in each duel act on
/// (they get it from RoundStarted/RoundScored). Duels are reduced to who
/// is busy, so a late joiner knows who can't be challenged.
type RoomActivityView =
    | RoomOpen of playersInDuels: PlayerId list
    | RoomGathering of CongregationLobby
    | RoomCongregating of CongregationGame

module RoomActivityView =
    let ofRoom (room: Room) =
        match room.Activity with
        | Duels duels -> RoomOpen(duels |> List.collect (fun s -> s.Participants))
        | Gathering lobby -> RoomGathering lobby
        | Congregating game -> RoomCongregating game

/// Where a room's broadcasts go: its players' group and its spectators'
/// group. Built from a live hub call's Clients or from an IHubContext's,
/// so the shared helpers below work from either.
type RoomChannels =
    { Players: IClientProxy
      Spectators: IClientProxy }

let private channelsOf (clients: IHubClients<IClientProxy>) (roomCode: string) =
    { Players = clients.Group(roomCode)
      Spectators = clients.Group(spectatorGroupOf roomCode) }

let private sendGameOver (channels: RoomChannels) (session: GameSession) (reason: GameOverReason) =
    channels.Players.SendAsync(GameOverEvent, session.GameId, session.Scores, session.Participants, reason)

let private announceActivity (channels: RoomChannels) (room: Room) =
    channels.Players.SendAsync(RoomActivityChangedEvent, RoomActivityView.ofRoom room)

/// Pushes the room's leaderboard to players and spectators alike. The
/// snapshot carries no in-progress verse reference (see BoardRound), so it
/// is safe for both.
let private pushLeaderboard (channels: RoomChannels) (rules: CongregationRules) (room: Room) =
    task {
        let board = Leaderboard.ofRoom rules room
        do! channels.Players.SendAsync(LeaderboardUpdatedEvent, board)
        do! channels.Spectators.SendAsync(LeaderboardUpdatedEvent, board)
    }

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
/// (an empty/misconfigured book+chapter selection). A game played over
/// the whole Bible favors the famous verses — see FamousVerses.
let private pickRandomVerse
    (verses: Verse list)
    (famous: FamousVerses.Settings)
    (gameType: GameType)
    : VerseReference option =
    let numbersByBookName = Verse.bookNumbers verses
    let books, chaptersByBook = GameType.restrictionOf gameType
    let candidates = verses |> List.filter (Verse.matchesRestrictionByNumber numbersByBookName books chaptersByBook)

    if candidates.IsEmpty then
        None
    elif GameType.drawsFromWholeBible gameType then
        Some(
            Verse.referenceOfIn
                numbersByBookName
                (FamousVerses.pickOne Random.Shared.Next famous.ChancePercent numbersByBookName candidates)
        )
    else
        Some(Verse.referenceOfIn numbersByBookName candidates[Random.Shared.Next(candidates.Length)])

/// Everything the round-resolving helpers below need besides the room
/// itself — bundled so the hub, the timeout sweep and the presence sweep
/// pass the same thing.
type GameServices =
    { Rooms: RoomStore
      Verses: Verse list
      Famous: FamousVerses.Settings
      Rules: CongregationRules }

/// Why a round is being resolved. The matching condition is re-checked
/// INSIDE the atomic room update, so a resolve that lost a race (the round
/// was already scored, or a new one has started since) does nothing
/// rather than scoring the wrong round.
type private ResolveTrigger =
    /// Everyone the round waits for has guessed — see
    /// GameSession.allExpectedGuessed.
    | EveryoneGuessed
    /// The round's time limit has elapsed — see GameSession.isRoundExpired.
    | TimeUp of now: DateTimeOffset

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
    | DuelCompleted of scored: GameSession
    | DuelAdvanced of scored: GameSession * advanced: GameSession
    /// A Congregation round was scored; it stays revealed for the
    /// session's RevealPause before RoundTimeoutService moves on (see
    /// advanceRevealedRound).
    | CongregationRoundRevealed of scored: GameSession

/// Scores the CURRENT round of game `gameId` in the room at `roomCode`,
/// if `trigger` still holds, broadcasting accordingly — shared by
/// GameHub.SubmitGuess (everyone guessed), disconnects and departures
/// (whoever is left has all guessed) and RoundTimeoutService's sweep
/// (deadline elapsed), so every path uses identical logic. A duel then
/// either ends or advances to a freshly-picked verse straight away, as it
/// always has; a Congregation round stays revealed until its reveal pause
/// is over (see advanceRevealedRound).
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
/// only reflects whichever attempt's write actually won.
let private resolveRound
    (services: GameServices)
    (channels: RoomChannels)
    (roomCode: string)
    (gameId: GameId)
    (trigger: ResolveTrigger)
    : Task =
    task {
        let mutable resolution = NothingToResolve

        let updatedRoom =
            services.Rooms.Update(
                roomCode,
                fun room ->
                    resolution <- NothingToResolve

                    match Room.games room |> List.tryFind (fun s -> s.GameId = gameId) with
                    | None -> room
                    | Some session ->
                        let ready =
                            match session.Round, trigger with
                            | InProgress _, EveryoneGuessed -> GameSession.allExpectedGuessed (Room.isConnected room) session
                            | InProgress _, TimeUp now -> GameSession.isRoundExpired now session
                            | _ -> false // already resolved by a winning racer — leave as-is

                        if not ready then
                            room
                        else
                            let now = DateTimeOffset.UtcNow
                            let scored = GameSession.scoreRound now session

                            match session.Format with
                            | Congregation _ ->
                                resolution <- CongregationRoundRevealed scored
                                Room.updateGame gameId (fun _ -> scored) room
                            | Duel ->
                                let endCompleted () =
                                    resolution <- DuelCompleted scored
                                    Room.endGame gameId room

                                if GameSession.isOver scored then
                                    endCompleted ()
                                else
                                    match pickRandomVerse services.Verses services.Famous scored.GameType with
                                    | None ->
                                        // The book/chapter selection stopped
                                        // matching anything (shouldn't
                                        // normally happen — it matched at
                                        // game start) — end the game rather
                                        // than get stuck InProgress forever.
                                        endCompleted ()
                                    | Some nextVerse ->
                                        let advanced = GameSession.advanceRound nextVerse now scored
                                        resolution <- DuelAdvanced(scored, advanced)
                                        Room.updateGame gameId (fun _ -> advanced) room
            )

        match resolution, updatedRoom with
        | NothingToResolve, _
        | _, None -> ()
        | DuelCompleted scored, Some room ->
            do! channels.Players.SendAsync(RoundScoredEvent, scored)
            do! sendGameOver channels scored Completed
            do! announceActivity channels room
        | DuelAdvanced(scored, advanced), Some _ ->
            do! channels.Players.SendAsync(RoundScoredEvent, scored)
            do! channels.Players.SendAsync(RoundStartedEvent, advanced)
        | CongregationRoundRevealed scored, Some room ->
            do! channels.Players.SendAsync(RoundScoredEvent, scored)
            do! pushLeaderboard channels services.Rules room
    }

type private RevealOutcome =
    | NothingToAdvance
    | CongregationCompleted of GameSession
    | NextRoundStarted of GameSession

/// Moves the room's Congregation on once its scored round has been
/// revealed for the full reveal pause: to the next round, or — after the
/// last one — to the end of the game, which frees the room again. Same
/// decide-inside-one-Update discipline as resolveRound.
let private advanceRevealedRound (services: GameServices) (channels: RoomChannels) (roomCode: string) (now: DateTimeOffset) : Task =
    task {
        let mutable outcome = NothingToAdvance

        let updatedRoom =
            services.Rooms.Update(
                roomCode,
                fun room ->
                    outcome <- NothingToAdvance

                    match room.Activity with
                    | Congregating game when GameSession.isRevealOver now game.Session ->
                        let session = game.Session

                        let complete () =
                            outcome <- CongregationCompleted session
                            Room.endGame session.GameId room

                        if GameSession.isOver session then
                            complete ()
                        else
                            match pickRandomVerse services.Verses services.Famous session.GameType with
                            | None -> complete ()
                            | Some nextVerse ->
                                let advanced = GameSession.advanceRound nextVerse now session
                                outcome <- NextRoundStarted advanced
                                Room.updateGame session.GameId (fun _ -> advanced) room
                    | _ -> room
            )

        match outcome, updatedRoom with
        | NothingToAdvance, _
        | _, None -> ()
        | CongregationCompleted session, Some room ->
            do! sendGameOver channels session Completed
            do! announceActivity channels room
            do! pushLeaderboard channels services.Rules room
        | NextRoundStarted advanced, Some room ->
            do! channels.Players.SendAsync(RoundStartedEvent, advanced)
            do! pushLeaderboard channels services.Rules room
    }

/// Broadcasts what a removal (voluntary leave, stale-disconnect sweep,
/// same-name rejoin, leaving a Congregation) did to the room's games — see
/// RemovalImpact. Shared by every removal path so they can never disagree.
/// `room` is the room as stored after the removal.
let private broadcastRemovalImpact
    (services: GameServices)
    (channels: RoomChannels)
    (roomCode: string)
    (room: Room)
    (impact: RemovalImpact)
    : Task =
    task {
        match impact with
        | NothingAffected -> ()
        | DuelsForfeited forfeits ->
            for session, survivor in forfeits do
                do! sendGameOver channels session (Forfeited survivor)

            do! announceActivity channels room
        | CongregantsDeparted game ->
            // The activity carries who has left, so a participant who just
            // left sees the game as someone else's from now on.
            do! announceActivity channels room
            do! pushLeaderboard channels services.Rules room
            // Whoever just left may have been the last one the round was
            // waiting for.
            do! resolveRound services channels roomCode game.Session.GameId EveryoneGuessed
        | CongregationAbandoned game ->
            do! sendGameOver channels game.Session Abandoned
            do! announceActivity channels room
            do! pushLeaderboard channels services.Rules room
        | LobbyMembersRemoved _
        | LobbyCanceled _ ->
            do! announceActivity channels room
            do! pushLeaderboard channels services.Rules room
    }

let private lobbyErrorMessage (rules: CongregationRules) (error: LobbyError) =
    match error with
    | RoomBusy -> "A game is already running in this room. Wait until it's over."
    | RoundCountOutOfRange ->
        $"Choose between {CongregationLobby.minRoundCount} and {CongregationLobby.maxRoundCount} rounds."
    | TimeLimitOutOfRange ->
        $"A Congregation needs a time limit between {int rules.MinTimeLimit.TotalSeconds} and {int rules.MaxTimeLimit.TotalSeconds} seconds."
    | LobbyFull -> "This Congregation is full."
    | NoLobby -> "There is no open Congregation in this room."
    | NotHost -> "Only the host can do that."
    | NotAMember -> "You haven't joined this Congregation."
    | TooFewPlayers(have, need) -> $"A Congregation needs at least {need} connected players. It has {have}."

[<Literal>]
let private NotInRoomMessage = "You haven't joined a room"

[<Literal>]
let private CongregationHasRoomMessage =
    "A Congregation is using this room right now. Wait until it's over."

type GameHub(rooms: RoomStore, verses: Verse list, famous: FamousVerses.Settings, rules: CongregationRules) =
    inherit Hub()

    let services =
        { Rooms = rooms
          Verses = verses
          Famous = famous
          Rules = rules }

    member private this.Channels(roomCode: string) =
        channelsOf (this.Clients :> IHubClients<IClientProxy>) roomCode

    member private this.SendError(message: string) =
        this.Clients.Caller.SendAsync("Error", message)

    /// Adds the caller to the room as a new player, registers the
    /// connection, broadcasts PlayerJoined, and sends the joiner (only)
    /// recent chat history, the roster and what the room is doing — shared
    /// by JoinRoom and JoinWorldChat, which differ only in how they
    /// find/create the room to join. Returns the newly-created Player (via
    /// the invoke's return value) so the caller learns its own stable id —
    /// needed client-side to know which players-list entry is "me" (see
    /// chat-panel.ts's myPlayerId) and to target play requests.
    ///
    /// Enforces unique names within the room (see
    /// docs/SCRUM/Featue.UniquePlayerName.md) via Room.admit: fails
    /// outright (caller-only Error, no PlayerJoined) if `playerName` is
    /// already held by a currently-connected player. If it's held by a
    /// DISCONNECTED player instead, that stale entry is replaced — with
    /// the same PlayerLeft/GameOver broadcasts the periodic stale-
    /// disconnect sweep sends — or, if they were playing the running
    /// Congregation, the joiner takes over their seat and score. This is
    /// what makes reconnecting under your own name work rather than being
    /// rejected as a duplicate.
    member private this.JoinExistingRoom(roomCode: string, playerName: string) : Task<Player> =
        task {
            let player =
                { Id = PlayerId(Guid.NewGuid())
                  Name = playerName
                  Score = 0 }

            // The whole "is this name actually free, and if a stale
            // disconnected player is being replaced, what did that do"
            // decision happens INSIDE one RoomStore.Update call — reading
            // the room fresh on every (possibly retried) attempt — so a
            // concurrent join, disconnect, or game-ending event touching
            // the same room can't be silently discarded by this join's
            // write (see RoomStoreConcurrencyTests.fs).
            let mutable admission: Room.Admission option = None

            let updatedRoom =
                rooms.Update(
                    roomCode,
                    fun room ->
                        match Room.admit player room with
                        | Error() ->
                            admission <- None
                            room
                        | Ok admitted ->
                            admission <- Some admitted
                            admitted.Room
                )

            match updatedRoom, admission with
            | None, _ ->
                do! this.SendError "Room not found"
                return failwith "Room not found"
            | Some _, None ->
                do! this.SendError "That name is already taken in this room. Please choose another."
                return failwith "Name already taken"
            | Some updated, Some admitted ->
                let channels = this.Channels roomCode

                // A stale disconnected player of the same name was replaced
                // by this join — tell everyone else, exactly like
                // PlayerCleanupService's periodic sweep does.
                match admitted.Replaced with
                | Some removed ->
                    let (PlayerId removedGuid) = removed.Id
                    do! channels.Players.SendAsync(PlayerLeftEvent, string removedGuid)
                    do! broadcastRemovalImpact services channels roomCode updated admitted.Impact
                | None -> ()

                rooms.RegisterConnection(this.Context.ConnectionId, RoomCode roomCode, player)

                do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, roomCode)
                do! channels.Players.SendAsync(PlayerJoinedEvent, player)

                // RecentMessages is stored newest-first (see Room.addMessage);
                // reverse so the client receives/renders oldest-first.
                let history = updated.RecentMessages |> List.rev
                do! this.Clients.Caller.SendAsync(ChatHistoryEvent, history)

                // Full roster snapshot (including the joiner themself) so
                // players who joined earlier are visible right away, not
                // just future PlayerJoined broadcasts.
                do! this.Clients.Caller.SendAsync(RoomPlayersEvent, updated.Players)

                // What the room is doing, so a late joiner knows who is
                // busy and whether a Congregation has the room — and a
                // reseated participant gets their game back.
                do! this.Clients.Caller.SendAsync(RoomActivityChangedEvent, RoomActivityView.ofRoom updated)

                if admitted.Reseated then
                    do! pushLeaderboard channels rules updated

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
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                let trimmed = text.Trim()

                if trimmed = "" then
                    do! this.SendError "Message can't be empty"
                elif trimmed.Length > maxChatMessageLength then
                    do! this.SendError $"Message is too long (max {maxChatMessageLength} characters)"
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
    /// {Case:'Unlimited'}-shaped DU value by hand. Refused while a
    /// Congregation has the room.
    member this.SendPlayRequest(toPlayerId: string, gameType: GameType, roundCount: int, timeLimitSeconds: int option) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, sender) ->
                match rooms.TryGet(roomCode) with
                | None -> do! this.SendError "Room not found"
                | Some room ->
                    let targetId = PlayerId(Guid.Parse toPlayerId)

                    match room.Players |> List.tryFind (fun p -> p.Id = targetId) with
                    | None -> do! this.SendError "That player is no longer in the room"
                    | Some _ when not (Room.allowsDuels room) -> do! this.SendError CongregationHasRoomMessage
                    | Some _ when Room.isInActiveGame sender.Id room ->
                        do! this.SendError "You can't send a play request while a game is in progress"
                    | Some _ when Room.isInActiveGame targetId room -> do! this.SendError "That player is already in a game"
                    | Some _ ->
                        let timeLimit =
                            match timeLimitSeconds with
                            | None
                            | Some 0 -> Unlimited
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
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, sender) ->
                match rooms.Update(roomCode, Room.withdrawPlayRequest sender.Id) with
                | None -> ()
                | Some _ ->
                    let (PlayerId senderGuid) = sender.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayRequestWithdrawnEvent, string senderGuid)
        }

    /// Accepts the pending request from `fromPlayerId` to the caller —
    /// resolves the request AND starts the duel it described: picks the
    /// first verse (impure — Random, via pickRandomVerse, same idiom as
    /// /api/verses/random), then broadcasts PlayRequestAccepted (for "they
    /// accepted" UI feedback) immediately followed by RoundStarted carrying
    /// the full GameSession. A no-op (no broadcast at all) if the request
    /// was no longer there (e.g. withdrawn a moment earlier). Guarded by
    /// the one-active-game-per-player rule — refuses (caller-only Error) if
    /// either player already has a game running — and refused while a
    /// Congregation has the room. Other duels in the room are untouched.
    member this.AcceptPlayRequest(fromPlayerId: string) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, toPlayer) ->
                let fromId = PlayerId(Guid.Parse fromPlayerId)

                // The whole "is the room free, are both players actually
                // still free, is the request still there, and (if so)
                // starting the game with a freshly-picked verse" decision
                // happens INSIDE one RoomStore.Update call — reading the
                // room fresh on every (possibly retried) attempt — so a
                // concurrently-starting/ending game or withdrawn request
                // can't be missed (see RoomStoreConcurrencyTests.fs).
                let mutable outcome: Result<GameSession option, string> = Error NotInRoomMessage

                // Minted OUT here, not inside the Update closure below:
                // that closure is retried on contention (see RoomStore),
                // so generating the id inside would mint a different one
                // per attempt. One accepted request = one game = one id.
                let gameId = GameId(Guid.NewGuid())

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            if not (Room.allowsDuels room) then
                                outcome <- Error CongregationHasRoomMessage
                                room
                            elif Room.isInActiveGame fromId room || Room.isInActiveGame toPlayer.Id room then
                                outcome <- Error "You or that player already have a game in progress"
                                room
                            else
                                match room.PendingRequests |> List.tryFind (fun r -> r.FromPlayerId = fromId && r.ToPlayerId = toPlayer.Id) with
                                | None ->
                                    outcome <- Ok None
                                    room
                                | Some request ->
                                    match pickRandomVerse verses famous request.GameType with
                                    | None ->
                                        outcome <- Error "No verses match that game's book/chapter selection"
                                        room
                                    | Some firstVerse ->
                                        let updated, started =
                                            Room.acceptPlayRequest gameId fromId toPlayer.Id firstVerse DateTimeOffset.UtcNow room

                                        outcome <- Ok started
                                        updated
                    )

                match outcome, updatedRoom with
                | Error message, _ -> do! this.SendError message
                | Ok None, _
                | _, None -> () // request already gone (withdrawn/retargeted) — no-op
                | Ok(Some session), Some room ->
                    let (PlayerId fromGuid) = fromId
                    let (PlayerId toGuid) = toPlayer.Id
                    let channels = this.Channels roomCode
                    do! channels.Players.SendAsync(PlayRequestAcceptedEvent, string fromGuid, string toGuid)
                    do! channels.Players.SendAsync(RoundStartedEvent, session)
                    do! announceActivity channels room
        }

    /// Denies the pending request from `fromPlayerId` to the caller —
    /// resolves (removes) the request without starting anything. A no-op
    /// (no error) if that request is no longer there, same forgiving
    /// pattern as WithdrawPlayRequest.
    member this.DenyPlayRequest(fromPlayerId: string) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, toPlayer) ->
                let fromId = PlayerId(Guid.Parse fromPlayerId)

                match rooms.Update(roomCode, Room.denyPlayRequest fromId toPlayer.Id) with
                | None -> ()
                | Some _ ->
                    let (PlayerId fromGuid) = fromId
                    let (PlayerId toGuid) = toPlayer.Id
                    do! this.Clients.Group(roomCode).SendAsync(PlayRequestDeniedEvent, string fromGuid, string toGuid)
        }

    /// Submits the caller's guess for the current round of the game they
    /// are playing. `bookNumber` is the guessed book's 1-based position in
    /// the CALLER'S OWN VerseSource's Bible order (see
    /// frontend/src/shared-kernel/book-numbers.ts) — None if their own
    /// source couldn't resolve one for what they typed, in which case
    /// scoring falls back to name matching (see Scoring.correctParts).
    /// Errors (caller-only, no broadcast) if the caller isn't in a room,
    /// isn't playing a game, or the game's current round isn't InProgress
    /// (e.g. a late resubmit racing the round already resolving). On
    /// success: records the guess and resolves the round if everyone it
    /// waits for has now guessed (see resolveRound). A duel announces
    /// nothing on an individual guess; a Congregation updates its
    /// leaderboard, which shows who has guessed (never what).
    member this.SubmitGuess(book: string, bookNumber: int option, chapter: int option, verseNumber: int option) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                let guess: Guess =
                    { PlayerId = player.Id
                      Book = book
                      BookNumber = bookNumber
                      Chapter = chapter
                      VerseNumber = verseNumber
                      SubmittedAt = DateTimeOffset.UtcNow }

                // Records the guess inside one RoomStore.Update call —
                // reading the game fresh on every (possibly retried)
                // attempt rather than off a separately-read snapshot, so a
                // guess recorded by a concurrent SubmitGuess from another
                // player can never be silently overwritten by this one
                // (see RoomStoreConcurrencyTests.fs). The error cases are
                // re-checked fresh inside the closure too.
                let mutable outcome: Result<GameSession, string> = Error "You don't have an active game"

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            match Room.gameOf player.Id room with
                            | Some session ->
                                match session.Round with
                                | Scored _
                                | WaitingForPlayers ->
                                    outcome <- Error "This round is no longer accepting guesses"
                                    room
                                | InProgress _ ->
                                    outcome <- Ok session
                                    Room.updateGame session.GameId (GameSession.submitGuess player.Id guess) room
                            | None ->
                                outcome <- Error "You don't have an active game"
                                room
                    )

                match outcome, updatedRoom with
                | Error message, _ -> do! this.SendError message
                | Ok _, None -> ()
                | Ok session, Some room ->
                    let channels = this.Channels roomCode

                    match session.Format with
                    | Congregation _ -> do! pushLeaderboard channels rules room
                    | Duel -> ()

                    do! resolveRound services channels roomCode session.GameId EveryoneGuessed
        }

    /// Asks to be matched with any other waiting player — the single entry
    /// point for both halves of matchmaking (see
    /// docs/SCRUM/TODO/Feature.StartMulitplayerGameWaitForRandomPlayer.md
    /// and Feature.ConnectToRandomNextOpenGame.md). If someone is already
    /// waiting, a game starts immediately; otherwise the caller waits.
    ///
    /// Deliberately one method rather than "create a wait" and "join a
    /// wait": whether you wait or are matched depends entirely on who else
    /// happens to be in the queue at that instant, and splitting it would
    /// make that a race the client has to resolve. Refused while a
    /// Congregation has the room.
    member this.FindMatch(gameType: GameType, roundCount: int, timeLimitSeconds: int option) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                let timeLimit =
                    match timeLimitSeconds with
                    | Some seconds when seconds > 0 -> LimitedTo(TimeSpan.FromSeconds(float seconds))
                    | _ -> Unlimited

                // Minted outside the retried Update closure, for the same
                // reason as AcceptPlayRequest's.
                let gameId = GameId(Guid.NewGuid())
                let mutable started: GameSession option = None
                let mutable waiting = false
                let mutable refusal = "You already have a game in progress"

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            started <- None
                            waiting <- false

                            if not (Room.allowsDuels room) then
                                refusal <- CongregationHasRoomMessage
                                room
                            elif Room.isInActiveGame player.Id room then
                                refusal <- "You already have a game in progress"
                                room
                            else
                                match Room.findMatchFor player.Id room with
                                | Some opponent ->
                                    // The waiting player's settings win:
                                    // they asked first, and the joiner
                                    // opted into "whatever is open" rather
                                    // than a particular game.
                                    match pickRandomVerse verses famous opponent.GameType with
                                    | None -> room
                                    | Some firstVerse ->
                                        let session =
                                            GameSession.startDuel
                                                gameId
                                                opponent.PlayerId
                                                player.Id
                                                opponent.GameType
                                                opponent.RoundCount
                                                opponent.RoundTimeLimit
                                                firstVerse
                                                DateTimeOffset.UtcNow

                                        started <- Some session
                                        Room.startDuel session room
                                | None ->
                                    waiting <- true

                                    let entry =
                                        { PlayerId = player.Id
                                          GameType = gameType
                                          RoundCount = roundCount
                                          RoundTimeLimit = timeLimit
                                          WaitingSince = DateTimeOffset.UtcNow }

                                    Room.joinMatchmaking entry room
                    )

                match started, updatedRoom with
                | Some session, Some room ->
                    let channels = this.Channels roomCode
                    do! channels.Players.SendAsync(RoundStartedEvent, session)
                    do! announceActivity channels room
                | _ ->
                    if waiting then
                        do! this.Clients.Caller.SendAsync(WaitingForMatchEvent)
                    else
                        do! this.SendError refusal
        }

    /// Stops waiting to be matched. A no-op if the caller wasn't waiting,
    /// so a cancel racing a match can't fail loudly.
    member this.CancelMatchmaking() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                rooms.Update(roomCode, Room.leaveMatchmaking player.Id) |> ignore
                do! this.Clients.Caller.SendAsync(MatchmakingCancelledEvent)
        }

    /// The caller gives up the game they're playing. A duel ends
    /// (GameOver(Forfeited), naming the opponent as the surviving player).
    /// Leaving a Congregation only takes the caller out of it: the others
    /// play on, and the caller keeps their place on the leaderboard (see
    /// Room.leaveCongregationGame).
    member this.ForfeitGame() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                // Captures what was forfeited from INSIDE the atomic
                // update, not a separately-read snapshot, so it's always
                // what this call actually did.
                let mutable impact = NothingAffected

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            match Room.gameOf player.Id room with
                            | Some session when session.Format = Duel ->
                                let opponent = session.Participants |> List.tryFind (fun p -> p <> player.Id)
                                impact <- DuelsForfeited [ session, opponent ]
                                Room.forfeitGame player.Id room
                            | Some _ ->
                                let updated, departure = Room.leaveCongregationGame player.Id room
                                impact <- departure
                                updated
                            | None ->
                                impact <- NothingAffected
                                room
                    )

                match impact, updatedRoom with
                | NothingAffected, _
                | _, None ->
                    // There was no game left to forfeit — the opponent's
                    // disconnect/leave already ended it, and this call
                    // raced that. The caller is sitting in a confirm
                    // dialog waiting for an answer, so it MUST get one:
                    // silently returning here left that dialog stuck on
                    // "Forfeiting…" forever, with no way out (see
                    // docs/SCRUM/BUGS/BUG.CanForfeitAGameWhereConnectionLost.md).
                    do! this.SendError "That game has already ended"
                | _, Some room -> do! broadcastRemovalImpact services (this.Channels roomCode) roomCode room impact
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
    /// connection) and broadcasts PlayerLeft plus whatever that did to the
    /// room's games, the same way the other removal paths (stale-disconnect
    /// sweep, same-name replacement) do. A no-op if the caller isn't in a
    /// room (nothing to leave); deliberately does NOT drop the connection
    /// itself (RegisterConnection stays as-is), since the same connection
    /// may go on to join a different room next.
    member this.LeaveRoom() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> ()
            | Some(RoomCode roomCode, player) ->
                let mutable impact = NothingAffected

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            let updated, removal = Room.leave player.Id room
                            impact <- removal
                            updated
                    )

                let (PlayerId playerGuid) = player.Id
                let channels = this.Channels roomCode
                do! channels.Players.SendAsync(PlayerLeftEvent, string playerGuid)

                match updatedRoom with
                | Some room -> do! broadcastRemovalImpact services channels roomCode room impact
                | None -> ()
        }

    /// Opens a Congregation lobby in the caller's room, with the caller as
    /// host and first member — see docs/web/congregation. Only allowed in
    /// a private room (not World chat, which has no shareable code for the
    /// spectator board) while nothing else is running there. Opening
    /// claims the room: pending play requests are withdrawn and the
    /// matchmaking queue is emptied.
    member this.OpenCongregation(gameType: GameType, roundCount: int, timeLimitSeconds: int) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, _) when roomCode = WorldChatRoomCode ->
                do! this.SendError "A Congregation needs a private room. Create one and share its code."
            | Some(RoomCode roomCode, player) ->
                let host = { Id = player.Id; Name = player.Name }
                let timeLimit = TimeSpan.FromSeconds(float timeLimitSeconds)
                let mutable outcome: Result<PlayRequest list, LobbyError> = Error NoLobby

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            match Room.openCongregation rules host gameType roundCount timeLimit room with
                            | Ok(opened, dropped) ->
                                outcome <- Ok dropped
                                opened
                            | Error error ->
                                outcome <- Error error
                                room
                    )

                match outcome, updatedRoom with
                | Error error, _ -> do! this.SendError(lobbyErrorMessage rules error)
                | Ok _, None -> ()
                | Ok dropped, Some room ->
                    let channels = this.Channels roomCode

                    for request in dropped do
                        let (PlayerId fromGuid) = request.FromPlayerId
                        do! channels.Players.SendAsync(PlayRequestWithdrawnEvent, string fromGuid)

                    do! channels.Players.SendAsync(MatchmakingCancelledEvent)
                    do! announceActivity channels room
                    do! pushLeaderboard channels rules room
        }

    member private this.ChangeLobby(change: Player -> Room -> Result<Room, LobbyError>) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                let mutable outcome: Result<unit, LobbyError> = Error NoLobby

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            match change player room with
                            | Ok changed ->
                                outcome <- Ok()
                                changed
                            | Error error ->
                                outcome <- Error error
                                room
                    )

                match outcome, updatedRoom with
                | Error error, _ -> do! this.SendError(lobbyErrorMessage rules error)
                | Ok(), None -> ()
                | Ok(), Some room ->
                    let channels = this.Channels roomCode
                    do! announceActivity channels room
                    do! pushLeaderboard channels rules room
        }

    /// Joins the open Congregation lobby in the caller's room. Joining
    /// twice is harmless; a full lobby refuses. The capacity check happens
    /// inside the atomic update, so simultaneous joins can't overfill it.
    member this.JoinCongregation() : Task =
        this.ChangeLobby(fun player room -> Room.joinCongregation rules { Id = player.Id; Name = player.Name } room)

    /// Leaves the open lobby. The host leaving cancels it.
    member this.LeaveCongregation() : Task =
        this.ChangeLobby(fun player room -> Room.leaveCongregation player.Id room |> Result.map fst)

    /// The host cancels their lobby without starting it.
    member this.CancelCongregation() : Task =
        this.ChangeLobby(fun player room -> Room.cancelCongregation player.Id room |> Result.map fst)

    /// The host starts the lobby's game with the members connected right
    /// now. Nobody can join after this.
    member this.StartCongregation() : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.SendError NotInRoomMessage
            | Some(RoomCode roomCode, player) ->
                // Minted outside the retried Update closure, for the same
                // reason as AcceptPlayRequest's.
                let gameId = GameId(Guid.NewGuid())
                let mutable outcome: Result<CongregationGame, string> = Error(lobbyErrorMessage rules NoLobby)

                let updatedRoom =
                    rooms.Update(
                        roomCode,
                        fun room ->
                            match room.Activity with
                            | Gathering lobby ->
                                match pickRandomVerse verses famous lobby.GameType with
                                | None ->
                                    outcome <- Error "No verses match that game's book/chapter selection"
                                    room
                                | Some firstVerse ->
                                    match Room.startCongregation rules player.Id gameId firstVerse DateTimeOffset.UtcNow room with
                                    | Ok(started, game) ->
                                        outcome <- Ok game
                                        started
                                    | Error error ->
                                        outcome <- Error(lobbyErrorMessage rules error)
                                        room
                            | _ ->
                                outcome <- Error(lobbyErrorMessage rules NoLobby)
                                room
                    )

                match outcome, updatedRoom with
                | Error message, _ -> do! this.SendError message
                | Ok _, None -> ()
                | Ok game, Some room ->
                    let channels = this.Channels roomCode
                    do! announceActivity channels room
                    do! channels.Players.SendAsync(RoundStartedEvent, game.Session)
                    do! pushLeaderboard channels rules room
        }

    /// Opens the read-only spectator board for `roomCode` — anyone with
    /// the link, no name, no join (see docs/web/congregation). The
    /// connection is added to the room's SPECTATOR group only: never
    /// registered as a player (so every player-only method answers "You
    /// haven't joined a room") and never added to the room group, whose
    /// RoundStarted carries the reference of the round being guessed.
    /// Returns the current board; LeaderboardUpdated follows on every
    /// change.
    member this.WatchRoom(roomCode: string) : Task<LeaderboardSnapshot> =
        task {
            match rooms.TryGet(roomCode) with
            | None -> return raise (HubException "Room not found")
            | Some room ->
                do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, spectatorGroupOf roomCode)
                return Leaderboard.ofRoom rules room
        }

    member this.UnwatchRoom(roomCode: string) : Task =
        this.Groups.RemoveFromGroupAsync(this.Context.ConnectionId, spectatorGroupOf roomCode)

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
    /// (they were the target) per canceled request. A Congregation stops
    /// waiting for them, so their round may be ready to score now.
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
                // disconnected" and "requests canceled") of exactly the
                // kind rooms.Update itself exists to close. See
                // RoomStoreConcurrencyTests.fs.
                let mutable canceledRequests: PlayRequest list = []

                match
                    rooms.Update(
                        roomCode,
                        fun room ->
                            let disconnected = Room.markDisconnected player.Id DateTimeOffset.UtcNow room
                            let updated, canceled = Room.cancelPendingRequestsFor player.Id disconnected
                            canceledRequests <- canceled
                            updated
                    )
                with
                | None -> ()
                | Some room ->
                    let channels = this.Channels roomCode
                    let (PlayerId playerGuid) = player.Id
                    do! channels.Players.SendAsync(PlayerDisconnectedEvent, string playerGuid)

                    for request in canceledRequests do
                        let (PlayerId fromGuid) = request.FromPlayerId
                        let (PlayerId toGuid) = request.ToPlayerId

                        if request.FromPlayerId = player.Id then
                            do! channels.Players.SendAsync(PlayRequestWithdrawnEvent, string fromGuid)
                        else
                            do! channels.Players.SendAsync(PlayRequestDeniedEvent, string fromGuid, string toGuid)

                    match room.Activity with
                    | Gathering _ -> do! pushLeaderboard channels rules room
                    | Congregating game ->
                        do! pushLeaderboard channels rules room
                        do! resolveRound services channels roomCode game.Session.GameId EveryoneGuessed
                    | Duels _ -> ()
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
/// What that does to the room's games is broadcast the same way every
/// other removal path does (see broadcastRemovalImpact): a duel is
/// forfeited to the surviving opponent, a Congregation plays on without
/// them.
type PlayerCleanupService
    (
        rooms: RoomStore,
        verses: Verse list,
        famous: FamousVerses.Settings,
        rules: CongregationRules,
        hubContext: IHubContext<GameHub>,
        settings: PresenceSettings
    ) =
    inherit Microsoft.Extensions.Hosting.BackgroundService()

    let services =
        { Rooms = rooms
          Verses = verses
          Famous = famous
          Rules = rules }

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
                    let mutable impact = NothingAffected

                    try
                        let updatedRoom =
                            rooms.Update(
                                roomCode,
                                fun current ->
                                    let updated, removed, removal = Room.removeStaleDisconnections cutoff current
                                    removedIds <- removed
                                    impact <- removal
                                    updated
                            )

                        match updatedRoom with
                        | Some updated when not removedIds.IsEmpty ->
                            let channels = channelsOf (hubContext.Clients :> IHubClients<IClientProxy>) roomCode

                            for PlayerId removedGuid in removedIds do
                                do! channels.Players.SendAsync(PlayerLeftEvent, string removedGuid)

                            do! broadcastRemovalImpact services channels roomCode updated impact
                        | _ -> ()
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

/// Periodically sweeps every game in every room for a round whose time
/// limit has elapsed and auto-resolves it (scores whoever guessed,
/// implicit 0 for whoever didn't, then advances/ends the game), and moves
/// a Congregation on once its scored round has been revealed long enough
/// — mirrors PlayerCleanupService's sweep-and-broadcast-via-IHubContext
/// pattern exactly, since this is the same shape of problem: something
/// server-initiated that isn't triggered by any client call. A 1-second
/// default interval (vs. PlayerCleanupService's 30s) so a short round
/// timer still feels responsive — still trivially cheap for what's
/// normally a handful of in-memory rooms. Self-healing against races with
/// SubmitGuess resolving the same round moments earlier: resolveRound
/// re-checks the expiry inside its atomic update, so a round already
/// scored is simply skipped.
type RoundTimeoutService
    (
        rooms: RoomStore,
        verses: Verse list,
        famous: FamousVerses.Settings,
        rules: CongregationRules,
        hubContext: IHubContext<GameHub>,
        settings: RoundTimeoutSettings
    ) =
    inherit Microsoft.Extensions.Hosting.BackgroundService()

    let services =
        { Rooms = rooms
          Verses = verses
          Famous = famous
          Rules = rules }

    override _.ExecuteAsync(stoppingToken: Threading.CancellationToken) : Task =
        task {
            while not stoppingToken.IsCancellationRequested do
                let now = DateTimeOffset.UtcNow

                // Each room is swept inside its own try/with: resolveRound
                // ends in SendAsync, which can genuinely throw (a client
                // disconnecting mid-broadcast, a transport fault).
                // Unguarded, one such throw escapes ExecuteAsync, ends the
                // while loop and silently kills this BackgroundService for
                // the lifetime of the process — after which NO room's round
                // ever times out again, so every game everywhere sticks at
                // 0s until the server restarts. A single failing room must
                // only cost that room this tick; it'll be retried on the
                // next one.
                for room in rooms.AllRooms() do
                    let (RoomCode roomCode) = room.Code
                    let channels = channelsOf (hubContext.Clients :> IHubClients<IClientProxy>) roomCode

                    try
                        for session in Room.games room do
                            if GameSession.isRoundExpired now session then
                                do! resolveRound services channels roomCode session.GameId (TimeUp now)
                            elif GameSession.isRevealOver now session && session.Format <> Duel then
                                do! advanceRevealedRound services channels roomCode now
                    with ex ->
                        eprintfn "[RoundTimeoutService] failed to resolve round for room %s: %O" roomCode ex

                try
                    do! Task.Delay(settings.SweepInterval, stoppingToken)
                with :? OperationCanceledException ->
                    ()
        }
