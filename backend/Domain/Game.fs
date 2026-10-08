namespace BibleGuessr.Domain

open System

type RoomCode = RoomCode of string

/// Identifies one game instance. A game is NOT adequately identified by
/// the pair of players in it: the same two people can finish a game and
/// immediately start another, and a GameOver from the finished one still
/// matches that pair — which used to tear the new game down mid-round
/// (see docs/SCRUM/BUGS/BUG.StaleGameOverEndsTheWrongGame.md). Clients
/// match on this instead, and ignore any game-scoped message whose id
/// isn't the game they're currently playing.
type GameId = GameId of Guid

type Player =
    { Id: PlayerId
      Name: string
      Score: int }

/// A round's time limit, chosen by the challenger via a slider from
/// "infinite" to 1 minute (see docs/SCRUM/Feature.Time.md). It only ends
/// the round — it doesn't change what a guess is worth (see
/// docs/web/scoring). An explicit DU rather than TimeSpan option so "no
/// limit" is a named case every consumer (the round-timeout sweep) must
/// handle explicitly, rather than an ambiguous None that could be misread
/// as "not set yet".
type TimeLimit =
    | Unlimited
    | LimitedTo of TimeSpan

/// Result of scoring one player's guess against the round's actual verse.
/// Correct means the guess earned points — the same "correct" the
/// singleplayer feedback shows.
type GuessResult =
    { PlayerId: PlayerId
      Correct: bool
      PointsAwarded: int }

/// InProgress/Scored carry a VerseReference (book/chapter/verseNumber),
/// never a full Verse — see VerseReference's doc comment in Verses.fs for
/// why: the server must never send verse TEXT over the wire, since two
/// players in the same game may each be reading a different
/// translation/uploaded file. Each client resolves the reference to
/// displayable text from its own local VerseSource.
type RoundState =
    | WaitingForPlayers
    | InProgress of VerseReference
    | Scored of VerseReference * GuessResult list

/// A chat message sent within a room. Not persisted to disk — kept only in
/// memory as part of the room's RecentMessages, same lifetime as the room
/// itself (lost on server restart, same as everything else about a Room).
type ChatMessage =
    { PlayerId: PlayerId
      PlayerName: string
      Text: string
      SentAt: DateTimeOffset }

/// A "start a game" invite one player sends another, by clicking their name
/// in the room's players list (see docs/SCRUM/Feature.StartMPGame.md), for
/// the GameType/RoundCount/RoundTimeLimit they chose beforehand. The
/// challenged player can accept or deny it (see
/// docs/SCRUM/Feature.RequestToStartMPGame.md) — accepting starts the
/// synced GameSession described by this request (see Room.acceptPlayRequest
/// and GameSession); denying just resolves the request.
type PlayRequest =
    { FromPlayerId: PlayerId
      FromPlayerName: string
      ToPlayerId: PlayerId
      GameType: GameType
      /// Total rounds for the game if accepted — same 3-10 vocabulary as
      /// singleplayer's round-count slider (see
      /// frontend/src/components/game-setup.ts).
      RoundCount: int
      RoundTimeLimit: TimeLimit
      SentAt: DateTimeOffset }

/// Which kind of multiplayer game a GameSession is. A duel is the classic
/// one-vs-one game started by a play request or matchmaking; a
/// Congregation is a group game the host opened as a lobby (see
/// CongregationLobby and docs/web/congregation). The rules that differ
/// between them — who must guess before a round ends, whether a player
/// leaving ends the game — branch on this rather than on a player count.
type GameFormat =
    | Duel
    | Congregation of host: PlayerId

/// A synced multiplayer game in progress in a Room. Lives alongside chat
/// inside the Room rather than as a separate SignalR group — other players
/// keep chatting throughout; only Participants act on round state. A duel
/// ends once the final round is scored, or early via forfeit; a
/// Congregation keeps going while anyone is still playing (see
/// GameSession.depart).
type GameSession =
    { /// This game instance's own identity — see GameId. Assigned once at
      /// start and never changed as the game advances, so every round of
      /// one game shares it and no two games share one.
      GameId: GameId
      Format: GameFormat
      /// Everyone who started the game, in a fixed order (challenger
      /// first for a duel, join order for a Congregation). Nobody is ever
      /// added after the start.
      Participants: PlayerId list
      /// Congregation participants who left mid-game. They keep their
      /// score and their place on the leaderboard, but are no longer
      /// expected to guess, and any guess they send is ignored. Always
      /// empty for a duel — a duel ends when a player leaves.
      Departed: Set<PlayerId>
      GameType: GameType
      RoundCount: int
      RoundTimeLimit: TimeLimit
      /// How long a scored round stays revealed before the next one
      /// starts. Zero for a duel, which advances immediately as it always
      /// has; a Congregation pauses so players and the projector see the
      /// reveal together (see GameSession.isRevealOver).
      RevealPause: TimeSpan
      /// 0-based index of the current round.
      RoundIndex: int
      Round: RoundState
      /// When the current round's verse was picked/broadcast — the anchor
      /// the timeout sweep's deadline check is computed from.
      RoundStartedAt: DateTimeOffset option
      /// When the current round was scored — the anchor for RevealPause.
      /// None while the round is still being guessed.
      RoundScoredAt: DateTimeOffset option
      /// Guesses submitted for the CURRENT round only — cleared on every
      /// GameSession.advanceRound.
      GuessesThisRound: Map<PlayerId, Guess>
      /// Running total across the whole game so far, seeded to 0 for every
      /// participant at start. Not Player.Score, which stays unused — a
      /// game's score belongs to the game, not the player record, since a
      /// player can play many games over a room's lifetime.
      Scores: Map<PlayerId, int> }

/// How a GameSession ended — Completed once every round has been played
/// normally, Forfeited if a duel player left/disconnected (past the grace
/// period) or explicitly forfeited before the game finished, leaving
/// `remainingPlayer` (if any — both could be gone in the same disconnect
/// sweep) as the implicit winner. Abandoned when every participant of a
/// Congregation has left, so nobody is left to play the remaining rounds.
type GameOverReason =
    | Completed
    | Forfeited of remainingPlayer: PlayerId option
    | Abandoned

module GameSession =
    let private create
        (gameId: GameId)
        (format: GameFormat)
        (participants: PlayerId list)
        (gameType: GameType)
        (roundCount: int)
        (timeLimit: TimeLimit)
        (revealPause: TimeSpan)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        : GameSession =
        { GameId = gameId
          Format = format
          Participants = participants
          Departed = Set.empty
          GameType = gameType
          RoundCount = roundCount
          RoundTimeLimit = timeLimit
          RevealPause = revealPause
          RoundIndex = 0
          Round = InProgress firstVerse
          RoundStartedAt = Some startedAt
          RoundScoredAt = None
          GuessesThisRound = Map.empty
          Scores = participants |> List.map (fun p -> p, 0) |> Map.ofList }

    /// Starts a fresh duel between the two players a PlayRequest was
    /// between, with the request's GameType/RoundCount/RoundTimeLimit and
    /// an already-picked first verse (picking is impure — Random — and
    /// happens in the hub, mirroring /api/verses/random; see
    /// GameType.restrictionOf). Round 0, both scores zeroed, no guesses yet.
    ///
    /// `gameId` is passed in for the same reason `firstVerse` and
    /// `startedAt` are: minting a Guid is impure, so it happens in the
    /// hub and this stays a pure function of its arguments.
    let startDuel
        (gameId: GameId)
        (playerA: PlayerId)
        (playerB: PlayerId)
        (gameType: GameType)
        (roundCount: int)
        (timeLimit: TimeLimit)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        : GameSession =
        create gameId Duel [ playerA; playerB ] gameType roundCount timeLimit TimeSpan.Zero firstVerse startedAt

    /// Starts a Congregation for `participants` (the host included), with
    /// the lobby's settings. Takes a TimeSpan rather than a TimeLimit: a
    /// Congregation always has a time limit, or one idle player could
    /// stall the whole group.
    let startCongregation
        (gameId: GameId)
        (host: PlayerId)
        (participants: PlayerId list)
        (gameType: GameType)
        (roundCount: int)
        (timeLimit: TimeSpan)
        (revealPause: TimeSpan)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        : GameSession =
        create
            gameId
            (Congregation host)
            participants
            gameType
            roundCount
            (LimitedTo timeLimit)
            revealPause
            firstVerse
            startedAt

    let isParticipant (playerId: PlayerId) (session: GameSession) =
        session.Participants |> List.contains playerId

    /// A participant who hasn't left the game.
    let isActiveParticipant (playerId: PlayerId) (session: GameSession) =
        isParticipant playerId session && not (session.Departed.Contains playerId)

    let activeParticipants (session: GameSession) =
        session.Participants |> List.filter (fun p -> not (session.Departed.Contains p))

    /// Who the current round waits for before it can be scored early.
    /// A duel waits for both players, connected or not — a disconnected
    /// opponent is covered by the timer or the grace-period forfeit. A
    /// Congregation waits only for connected participants still playing,
    /// so one locked phone can't hold up the whole group.
    let expectedGuessers (isConnected: PlayerId -> bool) (session: GameSession) =
        match session.Format with
        | Duel -> session.Participants
        | Congregation _ -> activeParticipants session |> List.filter isConnected

    /// True once everyone the round waits for (see expectedGuessers) has a
    /// guess recorded. Never true when nobody is expected: a Congregation
    /// where everyone is offline must wait for its timer rather than race
    /// through every remaining round in an instant.
    let allExpectedGuessed (isConnected: PlayerId -> bool) (session: GameSession) =
        let expected = expectedGuessers isConnected session

        not expected.IsEmpty
        && expected |> List.forall session.GuessesThisRound.ContainsKey

    /// Records `guess` for an active participant, overwriting any earlier
    /// guess from the same player this round — a resubmission is
    /// harmless-idempotent rather than rejected, same forgiving spirit as
    /// Room.withdrawPlayRequest. No-op for anyone else (a stranger, or a
    /// Congregation participant who left), or if Round isn't InProgress
    /// (already Scored) — the hub is expected to have already checked
    /// this, but this stays total/safe to call regardless.
    let submitGuess (playerId: PlayerId) (guess: Guess) (session: GameSession) : GameSession =
        match session.Round with
        | InProgress _ when isActiveParticipant playerId session ->
            { session with GuessesThisRound = session.GuessesThisRound |> Map.add playerId guess }
        | _ -> session

    /// Scores the current round using every guess submitted so far (a
    /// player who never guessed this round — timeout — gets no GuessResult
    /// entry at all, an implicit 0 distinguishable from "guessed wrong"),
    /// by the game type's own rule (see GameType.scoreGuess) — the same
    /// points singleplayer gives; when a guess came in doesn't change them.
    /// Moves Round to Scored, folds the points into the running Scores and
    /// records `scoredAt` as the anchor for the reveal pause.
    let scoreRound (scoredAt: DateTimeOffset) (session: GameSession) : GameSession =
        match session.Round with
        | InProgress verse ->
            let results =
                session.Participants
                |> List.choose (fun pid ->
                    session.GuessesThisRound
                    |> Map.tryFind pid
                    |> Option.map (fun guess ->
                        let points = GameType.scoreGuess session.GameType verse guess

                        { PlayerId = pid
                          Correct = points > 0
                          PointsAwarded = points }))

            let updatedScores =
                results
                |> List.fold (fun scores r -> scores |> Map.change r.PlayerId (Option.map ((+) r.PointsAwarded))) session.Scores

            { session with
                Round = Scored(verse, results)
                RoundScoredAt = Some scoredAt
                Scores = updatedScores }
        | _ -> session

    /// Moves to the next round with an already-picked verse (impure pick
    /// happens in the hub, same as `startDuel`), clearing this round's
    /// guesses. Only meaningful to call when Round is Scored and there's
    /// another round left (see `isOver`) — the hub/sweep are expected to
    /// have already checked that.
    let advanceRound (nextVerse: VerseReference) (startedAt: DateTimeOffset) (session: GameSession) : GameSession =
        { session with
            RoundIndex = session.RoundIndex + 1
            Round = InProgress nextVerse
            RoundStartedAt = Some startedAt
            RoundScoredAt = None
            GuessesThisRound = Map.empty }

    /// True once the just-scored round was the last one (RoundIndex is
    /// 0-based, so the last round has RoundIndex = RoundCount - 1).
    let isOver (session: GameSession) = session.RoundIndex >= session.RoundCount - 1

    /// Whether the current round's time limit has elapsed — always false
    /// for Unlimited (never times out) or if the round isn't InProgress.
    /// Used by RoundTimeoutService's sweep to find rounds needing
    /// auto-scoring.
    let isRoundExpired (now: DateTimeOffset) (session: GameSession) =
        match session.Round, session.RoundTimeLimit, session.RoundStartedAt with
        | InProgress _, LimitedTo limit, Some startedAt -> now - startedAt >= limit
        | _ -> false

    /// Whether a scored round has been revealed for its full RevealPause,
    /// so the next round (or the game over) can follow. Used by the
    /// timeout sweep to move a Congregation on.
    let isRevealOver (now: DateTimeOffset) (session: GameSession) =
        match session.Round, session.RoundScoredAt with
        | Scored _, Some scoredAt -> now - scoredAt >= session.RevealPause
        | _ -> false

    /// Marks a Congregation participant as having left. Their score and
    /// any guess already recorded this round stay; they are simply no
    /// longer waited for. A no-op for non-participants.
    let depart (playerId: PlayerId) (session: GameSession) =
        if isParticipant playerId session then
            { session with Departed = session.Departed.Add playerId }
        else
            session

    /// Moves a participant's seat — score, this round's guess, host role,
    /// everything — from `oldId` to `newId`. A refreshed page or a locked
    /// phone rejoins the room as a brand-new Player (there's no
    /// same-identity resume), so this is what lets them carry on in the
    /// Congregation they were playing. A no-op for non-participants.
    let rebind (oldId: PlayerId) (newId: PlayerId) (session: GameSession) =
        if not (isParticipant oldId session) then
            session
        else
            let swap id = if id = oldId then newId else id

            let rekey (map: Map<PlayerId, 'v>) (fix: 'v -> 'v) =
                match map.TryFind oldId with
                | Some value -> map |> Map.remove oldId |> Map.add newId (fix value)
                | None -> map

            { session with
                Format =
                    match session.Format with
                    | Congregation host -> Congregation(swap host)
                    | Duel -> Duel
                Participants = session.Participants |> List.map swap
                Departed = session.Departed |> Set.map swap
                Round =
                    match session.Round with
                    | Scored(verse, results) -> Scored(verse, results |> List.map (fun r -> { r with PlayerId = swap r.PlayerId }))
                    | other -> other
                GuessesThisRound = rekey session.GuessesThisRound (fun g -> { g with PlayerId = newId })
                Scores = rekey session.Scores id }

/// A running Congregation: the shared GameSession plus the names of
/// everyone who started it, so the leaderboard can still name a
/// participant after they've left the room.
type CongregationGame =
    { Session: GameSession
      Roster: Participant list }

module CongregationGame =
    let rebind (oldId: PlayerId) (newId: PlayerId) (game: CongregationGame) =
        { Session = GameSession.rebind oldId newId game.Session
          Roster = game.Roster |> List.map (fun p -> if p.Id = oldId then { p with Id = newId } else p) }

/// What a room is doing with its one shared game area. A room either hosts
/// any number of independent duels, or is given over entirely to one
/// Congregation (gathering in a lobby, then playing) — never both, which a
/// single union makes impossible to represent rather than merely checked.
type RoomActivity =
    /// Zero or more one-vs-one games, oldest first. Empty means the room
    /// is idle: free to start a duel or open a Congregation lobby. A list
    /// rather than a Map keyed by GameId so the whole Room still
    /// serializes as plain JSON (see POST /api/rooms).
    | Duels of GameSession list
    /// A Congregation lobby is open. No duel can start until it's
    /// started or canceled.
    | Gathering of CongregationLobby
    | Congregating of CongregationGame

/// Who a removal (voluntary leave, stale-disconnect sweep, same-name
/// rejoin) affected besides the removed players themselves, so the hub
/// knows which events to broadcast. Shared by every removal path so they
/// can never disagree.
type RemovalImpact =
    | NothingAffected
    /// Each duel that lost a player, as it was just before the removal,
    /// with its surviving player (None if both were removed at once).
    | DuelsForfeited of (GameSession * PlayerId option) list
    /// Participants left a Congregation that is still being played.
    | CongregantsDeparted of CongregationGame
    /// The last active participants left; the game is over.
    | CongregationAbandoned of CongregationGame
    | LobbyMembersRemoved of CongregationLobby
    /// The host was removed, which cancels the lobby.
    | LobbyCanceled of CongregationLobby

/// One player waiting to be matched, with the settings they chose. The
/// settings travel with the entry so a match starts the game the waiting
/// player actually asked for, rather than whatever the joiner happened to
/// have selected.
type MatchmakingEntry =
    { PlayerId: PlayerId
      GameType: GameType
      RoundCount: int
      RoundTimeLimit: TimeLimit
      WaitingSince: DateTimeOffset }

type Room =
    { Code: RoomCode
      Players: Player list
      /// Superseded by Activity — never transitioned, kept only so
      /// existing code/tests that reference it don't need churn for zero
      /// functional gain. See Activity for the real round state.
      Round: RoundState
      /// The most recent chat messages, newest first, capped at
      /// Room.maxRecentMessages — sent to a player when they join so they
      /// have context instead of a blank chat log, without keeping
      /// unbounded history in memory for a long-lived room.
      RecentMessages: ChatMessage list
      /// Play requests currently outstanding in this room. A sender can
      /// only ever have one — see Room.sendPlayRequest.
      PendingRequests: PlayRequest list
      /// When each currently-disconnected player went offline. A player
      /// not in this map is presumed connected. Populated on
      /// OnDisconnectedAsync and swept by a background service that
      /// removes anyone who's been here longer than the grace period —
      /// see Room.markDisconnected/removeStaleDisconnected and
      /// GameHub.fs's PlayerCleanupService. Kept separate from Players
      /// itself (rather than, say, a per-player nullable timestamp) so
      /// "who's connected" stays a simple, cheap membership check.
      DisconnectedPlayers: Map<PlayerId, DateTimeOffset>
      /// The games running (or the Congregation gathering) in this room —
      /// see RoomActivity. Each player may be in at most one game at a
      /// time (see Room.isInActiveGame).
      Activity: RoomActivity
      /// The most recently finished Congregation, kept so a spectator
      /// board that (re)loads after the game still shows the final
      /// standings. Replaced when the next lobby opens.
      LastCongregation: CongregationGame option
      /// Players waiting to be matched with whoever else is waiting — see
      /// docs/SCRUM/TODO/Feature.StartMulitplayerGameWaitForRandomPlayer.md
      /// and Feature.ConnectToRandomNextOpenGame.md, which are the two
      /// halves of the same queue: one player waits, the next to arrive
      /// is paired with them.
      ///
      /// Ordered oldest-first, so whoever has waited longest is matched
      /// first rather than an arbitrary player being picked.
      WaitingForMatch: MatchmakingEntry list }

module Room =
    let maxRecentMessages = 20

    /// How long a disconnected player stays in the room (still visible in
    /// the Offline section — see docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md
    /// — but no longer targetable for a play request, see
    /// cancelPendingRequestsFor) before being swept out — generous enough
    /// to survive a page refresh or a brief network drop without looking
    /// like they left.
    let disconnectGracePeriod = TimeSpan.FromMinutes 2.0

    let private noDuels = Duels []

    let create code =
        { Code = code
          Players = []
          Round = WaitingForPlayers
          RecentMessages = []
          PendingRequests = []
          DisconnectedPlayers = Map.empty
          Activity = noDuels
          LastCongregation = None
          WaitingForMatch = [] }

    /// Every game currently running in the room — the duels, or the one
    /// Congregation.
    let games (room: Room) : GameSession list =
        match room.Activity with
        | Duels duels -> duels
        | Gathering _ -> []
        | Congregating game -> [ game.Session ]

    /// The game `playerId` is playing in, if any. A Congregation
    /// participant who left mid-game is no longer playing it.
    let gameOf (playerId: PlayerId) (room: Room) =
        games room |> List.tryFind (GameSession.isActiveParticipant playerId)

    /// Whether the room is free to start a duel: no Congregation lobby or
    /// game has claimed it.
    let allowsDuels (room: Room) =
        match room.Activity with
        | Duels _ -> true
        | Gathering _
        | Congregating _ -> false

    let isConnected (room: Room) (playerId: PlayerId) =
        not (room.DisconnectedPlayers.ContainsKey playerId)

    /// Prepends a new message and trims back down to maxRecentMessages.
    let addMessage (message: ChatMessage) (room: Room) =
        { room with RecentMessages = message :: room.RecentMessages |> List.truncate maxRecentMessages }

    /// Adds `request`, first dropping any existing request from the same
    /// sender (REPLACE semantics: a sender only ever has one outstanding
    /// request, so retargeting a different player silently supersedes the
    /// old request rather than requiring an explicit withdraw first).
    let sendPlayRequest (request: PlayRequest) (room: Room) =
        let others = room.PendingRequests |> List.filter (fun r -> r.FromPlayerId <> request.FromPlayerId)
        { room with PendingRequests = request :: others }

    /// Removes whatever request `fromPlayerId` currently has pending, if any.
    let withdrawPlayRequest (fromPlayerId: PlayerId) (room: Room) =
        { room with PendingRequests = room.PendingRequests |> List.filter (fun r -> r.FromPlayerId <> fromPlayerId) }

    /// Removes the pending request from `fromPlayerId` to `toPlayerId`, if it
    /// still exists — shared by acceptPlayRequest/denyPlayRequest, which
    /// differ only in which event the caller broadcasts afterwards. A no-op
    /// if that exact request is no longer there (e.g. already withdrawn or
    /// retargeted), same forgiving semantics as withdrawPlayRequest.
    let private removePlayRequest (fromPlayerId: PlayerId) (toPlayerId: PlayerId) (room: Room) =
        { room with
            PendingRequests =
                room.PendingRequests
                |> List.filter (fun r -> not (r.FromPlayerId = fromPlayerId && r.ToPlayerId = toPlayerId)) }

    /// Takes every player of a game that is starting out of the
    /// matchmaking queue — see startDuel.
    let private leaveMatchmakingAll (playerIds: PlayerId list) (room: Room) =
        { room with
            WaitingForMatch = room.WaitingForMatch |> List.filter (fun e -> not (playerIds |> List.contains e.PlayerId)) }

    /// Whether `playerId` is currently playing a game in this room — the
    /// one-active-game-per-player guard's core check, used by
    /// SendPlayRequest/AcceptPlayRequest/FindMatch.
    let isInActiveGame (playerId: PlayerId) (room: Room) = (gameOf playerId room).IsSome

    /// Adds `session` as one more duel in the room. Refused (room returned
    /// unchanged) while a Congregation has the room, or if either player is
    /// already in a game — a pure function can't signal "refused" any
    /// other way, so callers check the result with isInActiveGame. Other
    /// duels already running are left untouched: a room hosts any number
    /// of them side by side.
    ///
    /// Both players leave the matchmaking queue: an entry left behind would
    /// match them later into a game they no longer asked for.
    let startDuel (session: GameSession) (room: Room) =
        match room.Activity with
        | Duels duels when session.Participants |> List.forall (fun p -> not (isInActiveGame p room)) ->
            { room with Activity = Duels(duels @ [ session ]) }
            |> leaveMatchmakingAll session.Participants
        | _ -> room

    /// The challenged player accepts `fromPlayerId`'s request to them:
    /// removes the request AND starts the duel it described, using the
    /// already-picked `firstVerse` (impure pick happens in the hub — see
    /// GameSession.startDuel's doc comment) and `startedAt`. Returns the
    /// started session alongside the updated room, or None if no game
    /// started — the request was no longer there (e.g. withdrawn or
    /// retargeted a moment earlier), or the room or a player isn't free
    /// (see startDuel) — in which case the room is returned unchanged.
    let acceptPlayRequest
        (gameId: GameId)
        (fromPlayerId: PlayerId)
        (toPlayerId: PlayerId)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        (room: Room)
        : Room * GameSession option =
        match room.PendingRequests |> List.tryFind (fun r -> r.FromPlayerId = fromPlayerId && r.ToPlayerId = toPlayerId) with
        | None -> room, None
        | Some request ->
            let session =
                GameSession.startDuel
                    gameId
                    fromPlayerId
                    toPlayerId
                    request.GameType
                    request.RoundCount
                    request.RoundTimeLimit
                    firstVerse
                    startedAt

            let started = room |> removePlayRequest fromPlayerId toPlayerId |> startDuel session

            if started.Activity = room.Activity then room, None else started, Some session

    /// The challenged player denies `fromPlayerId`'s request to them —
    /// resolves (removes) the request without starting anything.
    let denyPlayRequest (fromPlayerId: PlayerId) (toPlayerId: PlayerId) (room: Room) =
        removePlayRequest fromPlayerId toPlayerId room

    /// All requests currently addressed to `toPlayerId`.
    let pendingRequestsFor (toPlayerId: PlayerId) (room: Room) =
        room.PendingRequests |> List.filter (fun r -> r.ToPlayerId = toPlayerId)

    /// Puts `entry`'s player in the waiting queue, or replaces their
    /// existing entry if they were already waiting — a player can only ever
    /// hold one place in the queue, so re-requesting with different settings
    /// updates rather than duplicates.
    ///
    /// Refuses (returns the room unchanged) for a player already in a game
    /// — they cannot be matched into a second one — and while a
    /// Congregation has the room.
    let joinMatchmaking (entry: MatchmakingEntry) (room: Room) =
        if isInActiveGame entry.PlayerId room || not (allowsDuels room) then
            room
        else
            let withoutExisting = room.WaitingForMatch |> List.filter (fun e -> e.PlayerId <> entry.PlayerId)
            { room with WaitingForMatch = withoutExisting @ [ entry ] }

    /// Removes a player from the queue — canceling, leaving, or being
    /// matched. A no-op if they weren't waiting.
    let leaveMatchmaking (playerId: PlayerId) (room: Room) =
        { room with WaitingForMatch = room.WaitingForMatch |> List.filter (fun e -> e.PlayerId <> playerId) }

    /// Whether `playerId` is currently waiting to be matched.
    let isWaitingForMatch (playerId: PlayerId) (room: Room) =
        room.WaitingForMatch |> List.exists (fun e -> e.PlayerId = playerId)

    /// The longest-waiting player `joinerId` could be matched with, if any.
    ///
    /// Deliberately skips the joiner's own entry (a player must never be
    /// matched with themselves), anyone who has since started a game, and
    /// anyone no longer in the room — a queue entry outlives neither.
    let findMatchFor (joinerId: PlayerId) (room: Room) =
        room.WaitingForMatch
        |> List.tryFind (fun e ->
            e.PlayerId <> joinerId
            && not (isInActiveGame e.PlayerId room)
            && room.Players |> List.exists (fun p -> p.Id = e.PlayerId))

    /// Applies `f` to the game with id `gameId` — the plumbing every
    /// guess-submit/round-advance/score/timeout hub action goes through.
    /// A no-op if no such game is running.
    let updateGame (gameId: GameId) (f: GameSession -> GameSession) (room: Room) =
        match room.Activity with
        | Duels duels -> { room with Activity = Duels(duels |> List.map (fun s -> if s.GameId = gameId then f s else s)) }
        | Congregating game when game.Session.GameId = gameId ->
            { room with Activity = Congregating { game with Session = f game.Session } }
        | _ -> room

    /// Ends the game with id `gameId` — called once its final round has
    /// been scored, or when it ends early. Ending the Congregation frees
    /// the room for duels again and keeps the final result for the
    /// spectator board. A no-op if no such game is running.
    let endGame (gameId: GameId) (room: Room) =
        match room.Activity with
        | Duels duels -> { room with Activity = Duels(duels |> List.filter (fun s -> s.GameId <> gameId)) }
        | Congregating game when game.Session.GameId = gameId ->
            { room with
                Activity = noDuels
                LastCongregation = Some game }
        | _ -> room

    /// `leavingPlayerId` forfeits the duel they're playing, if any — ends
    /// it (same as `endGame`) so the caller can broadcast
    /// GameOver(Forfeited) to the room. A no-op (room unchanged) if they
    /// aren't in a duel. Leaving a Congregation is leaveCongregationGame.
    let forfeitGame (leavingPlayerId: PlayerId) (room: Room) =
        match gameOf leavingPlayerId room with
        | Some session when session.Format = Duel -> endGame session.GameId room
        | _ -> room

    /// A participant leaves the running Congregation without leaving the
    /// room. Their score stays on the leaderboard. Returns the impact — see
    /// RemovalImpact — or NothingAffected if they weren't playing it.
    let leaveCongregationGame (playerId: PlayerId) (room: Room) : Room * RemovalImpact =
        match room.Activity with
        | Congregating game when GameSession.isActiveParticipant playerId game.Session ->
            let departed = { game with Session = GameSession.depart playerId game.Session }

            if (GameSession.activeParticipants departed.Session).IsEmpty then
                { room with
                    Activity = noDuels
                    LastCongregation = Some departed },
                CongregationAbandoned departed
            else
                { room with Activity = Congregating departed }, CongregantsDeparted departed
        | _ -> room, NothingAffected

    /// Opens a Congregation lobby with `host` as its first member. Only
    /// allowed while the room is idle — no duel running, no other lobby or
    /// Congregation. Opening claims the room, so every pending play
    /// request and matchmaking entry is dropped; the dropped requests are
    /// returned so the hub can tell their senders.
    let openCongregation
        (rules: CongregationRules)
        (host: Participant)
        (gameType: GameType)
        (roundCount: int)
        (timeLimit: TimeSpan)
        (room: Room)
        : Result<Room * PlayRequest list, LobbyError> =
        match room.Activity with
        | Duels duels when duels.IsEmpty ->
            CongregationLobby.create rules host gameType roundCount timeLimit
            |> Result.map (fun lobby ->
                { room with
                    Activity = Gathering lobby
                    LastCongregation = None
                    PendingRequests = []
                    WaitingForMatch = [] },
                room.PendingRequests)
        | _ -> Error RoomBusy

    let joinCongregation (rules: CongregationRules) (participant: Participant) (room: Room) =
        match room.Activity with
        | Gathering lobby ->
            CongregationLobby.join rules participant lobby
            |> Result.map (fun joined -> { room with Activity = Gathering joined })
        | _ -> Error NoLobby

    /// A member leaves the lobby. The host leaving cancels the lobby
    /// altogether (LobbyCanceled) — there is nobody left who could start
    /// it.
    let leaveCongregation (playerId: PlayerId) (room: Room) : Result<Room * RemovalImpact, LobbyError> =
        match room.Activity with
        | Gathering lobby when lobby.Host.Id = playerId -> Ok({ room with Activity = noDuels }, LobbyCanceled lobby)
        | Gathering lobby when CongregationLobby.isMember playerId lobby ->
            let remaining = CongregationLobby.leave playerId lobby
            Ok({ room with Activity = Gathering remaining }, LobbyMembersRemoved remaining)
        | Gathering _ -> Error NotAMember
        | _ -> Error NoLobby

    /// The host cancels their lobby without starting it.
    let cancelCongregation (playerId: PlayerId) (room: Room) : Result<Room * CongregationLobby, LobbyError> =
        match room.Activity with
        | Gathering lobby when lobby.Host.Id = playerId -> Ok({ room with Activity = noDuels }, lobby)
        | Gathering _ -> Error NotHost
        | _ -> Error NoLobby

    /// The host starts their lobby's game with the members who are
    /// connected right now (see CongregationLobby.startingMembers), the
    /// already-picked first verse (impure, picked in the hub) and the
    /// rules' reveal pause.
    let startCongregation
        (rules: CongregationRules)
        (playerId: PlayerId)
        (gameId: GameId)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        (room: Room)
        : Result<Room * CongregationGame, LobbyError> =
        match room.Activity with
        | Gathering lobby when lobby.Host.Id = playerId ->
            CongregationLobby.startingMembers rules (isConnected room) lobby
            |> Result.map (fun members ->
                let session =
                    GameSession.startCongregation
                        gameId
                        lobby.Host.Id
                        (members |> List.map (fun m -> m.Id))
                        lobby.GameType
                        lobby.RoundCount
                        lobby.RoundTimeLimit
                        rules.RevealPause
                        firstVerse
                        startedAt

                let game = { Session = session; Roster = members }
                { room with Activity = Congregating game }, game)
        | Gathering _ -> Error NotHost
        | _ -> Error NoLobby

    /// Records that `playerId` just disconnected, at `at`. The player
    /// stays in Players (still visible/targetable) until a later sweep
    /// removes them for real — see removeStaleDisconnections.
    let markDisconnected (playerId: PlayerId) (at: DateTimeOffset) (room: Room) =
        { room with DisconnectedPlayers = room.DisconnectedPlayers |> Map.add playerId at }

    /// Un-marks `playerId` as disconnected, if it was — for a player who
    /// reconnects before the sweep catches up to them. Currently unused
    /// by any hub code path: "reconnect before the timeout" (see
    /// docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md) is
    /// satisfied instead by admit's same-name stale-entry handling (a
    /// rejoin under the same name replaces the old disconnected entry
    /// with a fresh one), not by resuming the old entry via this function.
    /// Kept for the future in case true same-identity session resume is
    /// ever built.
    let markReconnected (playerId: PlayerId) (room: Room) =
        { room with DisconnectedPlayers = room.DisconnectedPlayers |> Map.remove playerId }

    /// Immediately cancels any pending invitation involving `playerId`,
    /// the moment they disconnect — see
    /// docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md.
    /// Distinct from removeStaleDisconnections: at disconnect time the
    /// player is only MARKED disconnected (see markDisconnected above),
    /// not removed — they stay fully visible and, if mid-game, still
    /// playing. Only PendingRequests changes here; Players,
    /// DisconnectedPlayers, and Activity are all left untouched. Returns
    /// the updated room and the list of requests that were dropped, so the
    /// caller can broadcast the right withdrawn/denied-equivalent event per
    /// request — see GameHub.OnDisconnectedAsync. A no-op (empty list) if
    /// `playerId` had no pending request on either side.
    let cancelPendingRequestsFor (playerId: PlayerId) (room: Room) : Room * PlayRequest list =
        let canceled =
            room.PendingRequests
            |> List.filter (fun r -> r.FromPlayerId = playerId || r.ToPlayerId = playerId)

        if canceled.IsEmpty then
            room, []
        else
            { room with
                PendingRequests =
                    room.PendingRequests
                    |> List.filter (fun r -> r.FromPlayerId <> playerId && r.ToPlayerId <> playerId) },
            canceled

    /// Drops every trace of `idsToRemove` from the room's own bookkeeping
    /// — Players, DisconnectedPlayers, play requests, the matchmaking queue
    /// — without touching Activity. A request or queue entry naming a
    /// removed player is meaningless to keep around.
    let private forgetPlayers (idsToRemove: Set<PlayerId>) (room: Room) =
        { room with
            Players = room.Players |> List.filter (fun p -> not (idsToRemove.Contains p.Id))
            // A queue entry must never outlive its player, or the next
            // joiner would be matched against nobody.
            WaitingForMatch = room.WaitingForMatch |> List.filter (fun e -> not (idsToRemove.Contains e.PlayerId))
            DisconnectedPlayers = room.DisconnectedPlayers |> Map.filter (fun id _ -> not (idsToRemove.Contains id))
            PendingRequests =
                room.PendingRequests
                |> List.filter (fun r -> not (idsToRemove.Contains r.FromPlayerId) && not (idsToRemove.Contains r.ToPlayerId)) }

    /// What removing `idsToRemove` does to the room's Activity, and the
    /// resulting Activity — see RemovalImpact.
    let private removeFromActivity (idsToRemove: Set<PlayerId>) (room: Room) : Room * RemovalImpact =
        match room.Activity with
        | Duels duels ->
            let affected, remaining =
                duels |> List.partition (fun s -> s.Participants |> List.exists idsToRemove.Contains)

            if affected.IsEmpty then
                room, NothingAffected
            else
                let forfeits =
                    affected
                    |> List.map (fun s -> s, s.Participants |> List.tryFind (fun p -> not (idsToRemove.Contains p)))

                { room with Activity = Duels remaining }, DuelsForfeited forfeits
        | Gathering lobby when idsToRemove.Contains lobby.Host.Id -> { room with Activity = noDuels }, LobbyCanceled lobby
        | Gathering lobby when lobby.Members |> List.exists (fun m -> idsToRemove.Contains m.Id) ->
            let remaining = idsToRemove |> Set.fold (fun l id -> CongregationLobby.leave id l) lobby
            { room with Activity = Gathering remaining }, LobbyMembersRemoved remaining
        | Gathering _ -> room, NothingAffected
        | Congregating game ->
            let leaving =
                idsToRemove
                |> Set.filter (fun id -> GameSession.isActiveParticipant id game.Session)

            if leaving.IsEmpty then
                room, NothingAffected
            else
                let departed =
                    { game with Session = leaving |> Set.fold (fun s id -> GameSession.depart id s) game.Session }

                if (GameSession.activeParticipants departed.Session).IsEmpty then
                    { room with
                        Activity = noDuels
                        LastCongregation = Some departed },
                    CongregationAbandoned departed
                else
                    { room with Activity = Congregating departed }, CongregantsDeparted departed

    /// Removes every player in `idsToRemove` from the room entirely, along
    /// with any play requests and queue entries naming them. A duel they
    /// were in is forfeited — the opponent is freed up immediately rather
    /// than being stuck "in a game" against someone who no longer exists.
    /// A Congregation keeps going without them (they keep their score), a
    /// lobby drops them, and a lobby whose host is removed is canceled.
    /// Shared by removeStaleDisconnections (the periodic sweep), leave and
    /// admit (freeing up a disconnected player's name for their own
    /// reconnect), so every removal path has the same effect.
    let private removePlayers (idsToRemove: Set<PlayerId>) (room: Room) : Room * RemovalImpact =
        if idsToRemove.IsEmpty then
            room, NothingAffected
        else
            room |> forgetPlayers idsToRemove |> removeFromActivity idsToRemove

    /// Removes every player who's been disconnected since before `cutoff`
    /// (i.e. DisconnectedAt < cutoff — call with `DateTimeOffset.UtcNow -
    /// disconnectGracePeriod`). Returns the updated room, the ids removed
    /// (for the caller to broadcast PlayerLeft for each), and the impact
    /// on the room's games — see removePlayers.
    let removeStaleDisconnections (cutoff: DateTimeOffset) (room: Room) : Room * PlayerId list * RemovalImpact =
        let staleIds =
            room.DisconnectedPlayers
            |> Map.filter (fun _ disconnectedAt -> disconnectedAt < cutoff)
            |> Map.toList
            |> List.map fst
            |> Set.ofList

        let updated, impact = removePlayers staleIds room
        updated, staleIds |> Set.toList, impact

    /// Checked before letting a new player join under `name` — see
    /// docs/SCRUM/Featue.UniquePlayerName.md. Rejects (Error) if `name`
    /// (case-sensitive) is already held by a player who's currently
    /// CONNECTED. If it's held by a DISCONNECTED player instead — their
    /// own dropped connection reconnecting under the same name, most
    /// likely — that stale entry (and its pending requests/active game,
    /// same as removeStaleDisconnections) is removed first so the
    /// rejoin succeeds cleanly instead of either being rejected as a
    /// duplicate or leaving a ghost entry behind.
    let prepareJoin (name: string) (room: Room) : Result<Room, unit> =
        match room.Players |> List.tryFind (fun p -> p.Name = name) with
        | None -> Ok room
        | Some existing when room.DisconnectedPlayers.ContainsKey existing.Id ->
            let updated, _ = removePlayers (Set.singleton existing.Id) room
            Ok updated
        | Some _ -> Error()

    /// What admitting a player into the room did, besides adding them.
    type Admission =
        { Room: Room
          /// The disconnected player of the same name this join replaced.
          Replaced: Player option
          /// What removing `Replaced` did to the room's games — always
          /// NothingAffected when the seat was kept (see Reseated).
          Impact: RemovalImpact
          /// True when `Replaced` was playing the running Congregation and
          /// the newcomer took over their seat and score.
          Reseated: bool }

    /// Adds `player` to the room — the whole join decision in one pure
    /// step. A name held by a connected player is refused (Error), as in
    /// prepareJoin. A name held by a disconnected player replaces them: if
    /// they were playing the running Congregation, `player` keeps their
    /// seat and score (a refreshed page or a locked phone shouldn't throw
    /// anyone out of a group game); otherwise they're removed exactly as
    /// the stale-disconnect sweep would.
    let admit (player: Player) (room: Room) : Result<Admission, unit> =
        let added r = { r with Players = player :: r.Players }

        match room.Players |> List.tryFind (fun p -> p.Name = player.Name) with
        | None ->
            Ok
                { Room = added room
                  Replaced = None
                  Impact = NothingAffected
                  Reseated = false }
        | Some existing when room.DisconnectedPlayers.ContainsKey existing.Id ->
            match room.Activity with
            | Congregating game when GameSession.isActiveParticipant existing.Id game.Session ->
                let reseated =
                    { forgetPlayers (Set.singleton existing.Id) room with
                        Activity = Congregating(CongregationGame.rebind existing.Id player.Id game) }

                Ok
                    { Room = added reseated
                      Replaced = Some existing
                      Impact = NothingAffected
                      Reseated = true }
            | _ ->
                let updated, impact = removePlayers (Set.singleton existing.Id) room

                Ok
                    { Room = added updated
                      Replaced = Some existing
                      Impact = impact
                      Reseated = false }
        | Some _ -> Error()

    /// `playerId` VOLUNTARILY leaves the room — e.g. clicking "← Home" or
    /// "Back to chat selection" — as opposed to their connection merely
    /// dropping (see markDisconnected/removeStaleDisconnections).
    /// Removes them immediately and unconditionally, no grace period:
    /// this is a deliberate, in-the-moment departure, not a connection
    /// that might recover, so there's no reason to leave a stale entry
    /// around the way a dropped connection does. In particular, this is
    /// what makes it possible to come back into the room under the same
    /// name right away (see prepareJoin) rather than being told the name
    /// is still taken — the underlying SignalR connection is a
    /// page-lifetime singleton that's never stopped on navigation (see
    /// frontend/src/signalr-client.ts), so without this, "leaving" only
    /// ever tore down local UI state and the old Player stayed fully
    /// connected server-side for as long as the tab stayed open. Returns
    /// the updated room and the impact on its games — same shape as
    /// removeStaleDisconnections, for the same reason (the caller
    /// broadcasts exactly the same way either removal path does). A no-op
    /// if `playerId` isn't actually in the room.
    let leave (playerId: PlayerId) (room: Room) : Room * RemovalImpact =
        removePlayers (Set.singleton playerId) room
