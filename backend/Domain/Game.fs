namespace BibleGuessr.Domain

open System

type PlayerId = PlayerId of Guid
type RoomCode = RoomCode of string

type Player =
    { Id: PlayerId
      Name: string
      Score: int }

/// A guess a player submits for the current round's verse. Chapter and
/// VerseNumber are optional — a player can guess just the book — but
/// VerseNumber only makes sense alongside a Chapter guess.
///
/// BookNumber is the guessed book's 1-based position in the GUESSING
/// PLAYER'S OWN VerseSource's Bible order (see
/// frontend/src/game-type.ts) — set alongside `Book` (which stays for
/// display/singleplayer purposes) so multiplayer scoring can match by
/// number rather than name (see Scoring.isCorrectGuess and
/// VerseReference's doc comment on why name matching isn't reliable
/// across two players' different translations/files). None if the
/// player's own source couldn't resolve a number for what they typed
/// (falls back to name matching — see isCorrectGuess).
type Guess =
    { PlayerId: PlayerId
      Book: string
      BookNumber: int option
      Chapter: int option
      VerseNumber: int option
      SubmittedAt: DateTimeOffset }

/// Result of scoring one player's guess against the round's actual verse.
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

/// Which verses a challenged game will draw from — chosen by the challenger
/// before sending the request (see docs/SCRUM/Feature.RequestToStartMPGame.md),
/// so the challenged player can see what they're being invited to. Mirrors
/// the shape of the /api/verses/random restriction query params (see
/// Program.fs and Verse.matchesRestrictionByNumber) rather than
/// introducing a new vocabulary: AllVerses is "no restriction", Books
/// narrows to a subset of books, Chapters narrows further to specific
/// chapters within books.
///
/// Books/Chapters are keyed by book NUMBER, not name — see
/// Verses.fs's Verse.bookNumbers doc comment for why book names can't be
/// trusted to match across two players' different translations/uploaded
/// files (or even within the same one — bibelen-dk's own loader has
/// produced both "Jeremias" and "Jeremias." for one book). The challenger
/// picks books from their OWN VerseSource and sends the numbers THEIR OWN
/// source assigned those books (its own Bible-order position); the server
/// matches those numbers against its own pool's own book numbers (see
/// Verse.matchesRestrictionByNumber) — same book, regardless of spelling.
type GameType =
    | AllVerses
    | Books of int list
    | Chapters of Map<int, int list>

module GameType =
    /// Converts a GameType into Verse.matchesRestrictionByNumber's (books,
    /// chaptersByBook) shape — the server-side inverse of what
    /// frontend/src/game-type.ts's gameTypeFromRestriction does client-side
    /// for /api/verses/random's query params. Needed because the server
    /// (not the client) picks the verse for a multiplayer round — see
    /// GameHub.fs's AcceptPlayRequest/resolveRound.
    let restrictionOf (gameType: GameType) : Set<int> * Map<int, Set<int>> =
        match gameType with
        | AllVerses -> Set.empty, Map.empty
        | Books books -> Set.ofList books, Map.empty
        | Chapters chaptersByBook ->
            let books = chaptersByBook |> Map.toList |> List.map fst |> Set.ofList
            let chaptersByBookSets = chaptersByBook |> Map.map (fun _ chapters -> Set.ofList chapters)
            books, chaptersByBookSets

/// A round's time limit, chosen by the challenger via a slider from
/// "infinite" to 1 minute (see docs/SCRUM/Feature.Time.md). An explicit DU
/// rather than TimeSpan option so "no limit" is a named case every
/// consumer (Scoring, the round-timeout sweep) must handle explicitly,
/// rather than an ambiguous None that could be misread as "not set yet".
type TimeLimit =
    | Unlimited
    | LimitedTo of TimeSpan

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

/// A synced multiplayer game in progress between exactly two players in a
/// Room, started when one accepts the other's PlayRequest (see
/// Room.acceptPlayRequest). Lives alongside chat inside the Room rather
/// than as a separate SignalR group — other players keep chatting/sending
/// unrelated play requests throughout; only PlayerA/PlayerB act on round
/// state. Ends (Room.ActiveGame set back to None) once the final round is
/// scored, or early via forfeit (Room.forfeitGame, or
/// Room.removeStaleDisconnections when a participant goes stale).
type GameSession =
    { PlayerA: PlayerId
      PlayerB: PlayerId
      GameType: GameType
      RoundCount: int
      RoundTimeLimit: TimeLimit
      /// 0-based index of the current round.
      RoundIndex: int
      Round: RoundState
      /// When the current round's verse was picked/broadcast — the anchor
      /// GameSession.scoreRound's `elapsed` and the timeout sweep's
      /// deadline check are both computed from.
      RoundStartedAt: DateTimeOffset option
      /// Guesses submitted for the CURRENT round only — cleared on every
      /// GameSession.advanceRound.
      GuessesThisRound: Map<PlayerId, Guess>
      /// Running total across the whole game so far, seeded to 0 for both
      /// players at GameSession.start. Not Player.Score, which stays
      /// unused — a game's score belongs to the game, not the player
      /// record, since a player can play many games over a room's
      /// lifetime.
      Scores: Map<PlayerId, int> }

/// How a GameSession ended — Completed once every round has been played
/// normally, Forfeited if a player left/disconnected (past the grace
/// period) or explicitly forfeited before the game finished, leaving
/// `remainingPlayer` (if any — both could be gone in the same disconnect
/// sweep) as the implicit winner.
type GameOverReason =
    | Completed
    | Forfeited of remainingPlayer: PlayerId option

module Scoring =

    /// Points for a correct guess, decreasing the longer a player takes to answer.
    /// `elapsed` is time since the round started; `roundLength` is the total time allowed.
    let pointsForGuess (roundLength: TimeSpan) (elapsed: TimeSpan) (correct: bool) =
        if not correct then
            0
        else
            let remainingFraction =
                1.0 - (elapsed.TotalSeconds / roundLength.TotalSeconds) |> max 0.0

            let basePoints = 100
            let bonus = int (float basePoints * remainingFraction)
            basePoints + bonus

    /// Used to score multiplayer rounds (see GameSession.scoreRound) —
    /// matches the book by NUMBER, not name, whenever the guess has one:
    /// `guess`/`verse` may come from two different players' own
    /// translations/uploaded files, which can spell the same book
    /// differently (see VerseReference's doc comment). Falls back to name
    /// matching only if the guess has no BookNumber at all (the guessing
    /// player's own source couldn't resolve one for what they typed).
    let isCorrectGuess (verse: VerseReference) (guess: Guess) =
        let bookMatches =
            match guess.BookNumber with
            | Some bookNumber -> bookNumber = verse.BookNumber
            | None -> String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

        match guess.Chapter with
        | Some chapter -> bookMatches && chapter = verse.Chapter
        | None -> bookMatches

    /// Points awarded per level of a guess, each gated on every level before
    /// it being correct: the book alone is worth 10; the chapter only
    /// counts (100 more) if the book was also right; the verse number only
    /// counts (1000 more) if both book and chapter were right. An omitted
    /// Chapter/VerseNumber guess simply can't earn that level's points.
    let private bookPoints = 10
    let private chapterPoints = 100
    let private verseNumberPoints = 1000

    let pointsForVerseGuess (verse: VerseReference) (guess: Guess) =
        let bookCorrect =
            String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

        if not bookCorrect then
            0
        else
            let chapterCorrect =
                match guess.Chapter with
                | Some chapter -> chapter = verse.Chapter
                | None -> false

            if not chapterCorrect then
                bookPoints
            else
                let verseNumberCorrect =
                    match guess.VerseNumber with
                    | Some verseNumber -> verseNumber = verse.VerseNumber
                    | None -> false

                if verseNumberCorrect then
                    bookPoints + chapterPoints + verseNumberPoints
                else
                    bookPoints + chapterPoints

module GameSession =
    /// Starts a fresh game between the two players a PlayRequest was
    /// between, with the request's GameType/RoundCount/RoundTimeLimit and
    /// an already-picked first verse (picking is impure — Random — and
    /// happens in the hub, mirroring /api/verses/random; see
    /// GameType.restrictionOf). Round 0, both scores zeroed, no guesses yet.
    let start
        (playerA: PlayerId)
        (playerB: PlayerId)
        (gameType: GameType)
        (roundCount: int)
        (timeLimit: TimeLimit)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        : GameSession =
        { PlayerA = playerA
          PlayerB = playerB
          GameType = gameType
          RoundCount = roundCount
          RoundTimeLimit = timeLimit
          RoundIndex = 0
          Round = InProgress firstVerse
          RoundStartedAt = Some startedAt
          GuessesThisRound = Map.empty
          Scores = Map.ofList [ playerA, 0; playerB, 0 ] }

    /// True once both PlayerA and PlayerB have a guess recorded for the
    /// current round.
    let bothGuessed (session: GameSession) =
        session.GuessesThisRound.ContainsKey session.PlayerA
        && session.GuessesThisRound.ContainsKey session.PlayerB

    /// Records `guess` for whichever of PlayerA/PlayerB submitted it,
    /// overwriting any earlier guess from the same player this round — a
    /// resubmission is harmless-idempotent rather than rejected, same
    /// forgiving spirit as Room.withdrawPlayRequest. No-op if `playerId`
    /// isn't one of the two players in this session, or if Round isn't
    /// InProgress (already Scored) — the hub is expected to have already
    /// checked this, but this stays total/safe to call regardless.
    let submitGuess (playerId: PlayerId) (guess: Guess) (session: GameSession) : GameSession =
        match session.Round with
        | InProgress _ when playerId = session.PlayerA || playerId = session.PlayerB ->
            { session with GuessesThisRound = session.GuessesThisRound |> Map.add playerId guess }
        | _ -> session

    /// Scores the current round using every guess submitted so far (a
    /// player who never guessed this round — timeout — gets no GuessResult
    /// entry at all, an implicit 0 distinguishable from "guessed wrong"),
    /// via Scoring.pointsForGuess for a time-limited round or a flat 100
    /// for a correct guess in an unlimited-time round (there's no "time
    /// remaining" fraction to decay against without a limit). Moves Round
    /// to Scored and folds the points into the running Scores. `scoredAt`
    /// is passed in (rather than read from DateTimeOffset.UtcNow) so this
    /// stays pure/testable.
    let scoreRound (scoredAt: DateTimeOffset) (session: GameSession) : GameSession =
        match session.Round, session.RoundStartedAt with
        | InProgress verse, Some startedAt ->
            let elapsed = scoredAt - startedAt

            let pointsFor correct =
                match session.RoundTimeLimit with
                | Unlimited -> if correct then 100 else 0
                | LimitedTo roundLength -> Scoring.pointsForGuess roundLength elapsed correct

            let results =
                [ session.PlayerA; session.PlayerB ]
                |> List.choose (fun pid ->
                    session.GuessesThisRound
                    |> Map.tryFind pid
                    |> Option.map (fun guess ->
                        let correct = Scoring.isCorrectGuess verse guess
                        { PlayerId = pid
                          Correct = correct
                          PointsAwarded = pointsFor correct }))

            let updatedScores =
                results
                |> List.fold (fun scores r -> scores |> Map.change r.PlayerId (Option.map ((+) r.PointsAwarded))) session.Scores

            { session with
                Round = Scored(verse, results)
                Scores = updatedScores }
        | _ -> session

    /// Moves to the next round with an already-picked verse (impure pick
    /// happens in the hub, same as `start`), clearing this round's
    /// guesses. Only meaningful to call when Round is Scored and there's
    /// another round left (see `isOver`) — the hub/sweep are expected to
    /// have already checked that.
    let advanceRound (nextVerse: VerseReference) (startedAt: DateTimeOffset) (session: GameSession) : GameSession =
        { session with
            RoundIndex = session.RoundIndex + 1
            Round = InProgress nextVerse
            RoundStartedAt = Some startedAt
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

type Room =
    { Code: RoomCode
      Players: Player list
      /// Superseded by ActiveGame — never transitioned, kept only so
      /// existing code/tests that reference it don't need churn for zero
      /// functional gain. See ActiveGame for the real round state.
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
      /// The one synced game currently running in this room, if any — see
      /// GameSession. At most one at a time, and each player may be in at
      /// most one active game across the whole app (enforced at
      /// SendPlayRequest/AcceptPlayRequest — see GameHub.fs — not here). }
      ActiveGame: GameSession option }

module Room =
    let maxRecentMessages = 20

    /// How long a disconnected player stays in the room (still visible,
    /// still targetable for a play request) before being swept out —
    /// generous enough to survive a page refresh or a brief network drop
    /// without looking like they left.
    let disconnectGracePeriod = TimeSpan.FromMinutes 5.0

    let create code =
        { Code = code
          Players = []
          Round = WaitingForPlayers
          RecentMessages = []
          PendingRequests = []
          DisconnectedPlayers = Map.empty
          ActiveGame = None }

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

    /// The challenged player accepts `fromPlayerId`'s request to them:
    /// removes the request AND starts the game it described, using the
    /// already-picked `firstVerse` (impure pick happens in the hub — see
    /// GameSession.start's doc comment) and `startedAt`. Returns the
    /// accepted request alongside the updated room, or None if it was no
    /// longer there (e.g. withdrawn or retargeted a moment earlier) — in
    /// which case the room is returned unchanged and no game starts.
    let acceptPlayRequest
        (fromPlayerId: PlayerId)
        (toPlayerId: PlayerId)
        (firstVerse: VerseReference)
        (startedAt: DateTimeOffset)
        (room: Room)
        : Room * PlayRequest option =
        match room.PendingRequests |> List.tryFind (fun r -> r.FromPlayerId = fromPlayerId && r.ToPlayerId = toPlayerId) with
        | None -> room, None
        | Some request ->
            let withoutRequest = removePlayRequest fromPlayerId toPlayerId room

            let session =
                GameSession.start fromPlayerId toPlayerId request.GameType request.RoundCount request.RoundTimeLimit firstVerse startedAt

            { withoutRequest with ActiveGame = Some session }, Some request

    /// The challenged player denies `fromPlayerId`'s request to them —
    /// resolves (removes) the request without starting anything.
    let denyPlayRequest (fromPlayerId: PlayerId) (toPlayerId: PlayerId) (room: Room) =
        removePlayRequest fromPlayerId toPlayerId room

    /// All requests currently addressed to `toPlayerId`.
    let pendingRequestsFor (toPlayerId: PlayerId) (room: Room) =
        room.PendingRequests |> List.filter (fun r -> r.ToPlayerId = toPlayerId)

    /// Whether `playerId` is currently one of the two players in this
    /// room's ActiveGame, if there is one — the one-active-game-per-player
    /// guard's core check, used by SendPlayRequest/AcceptPlayRequest.
    let isInActiveGame (playerId: PlayerId) (room: Room) =
        match room.ActiveGame with
        | Some session -> session.PlayerA = playerId || session.PlayerB = playerId
        | None -> false

    /// Starts `session` as this room's ActiveGame. Only meaningful to call
    /// when room.ActiveGame is None (the hub is expected to have already
    /// checked isInActiveGame for both players via the guard above) —
    /// overwrites unconditionally otherwise, since a pure function has no
    /// way to signal "refused".
    let startGame (session: GameSession) (room: Room) = { room with ActiveGame = Some session }

    /// Replaces the room's ActiveGame with an updated session — the
    /// plumbing every guess-submit/round-advance/score/timeout hub action
    /// goes through. A no-op if there's no ActiveGame.
    let updateGame (f: GameSession -> GameSession) (room: Room) =
        { room with ActiveGame = room.ActiveGame |> Option.map f }

    /// Clears the room's ActiveGame — called once the final round has been
    /// scored/broadcast, or when a game ends early via forfeit.
    let endGame (room: Room) = { room with ActiveGame = None }

    /// `leavingPlayerId` forfeits the room's ActiveGame, if they're part of
    /// one — ends the game (same as `endGame`) so the caller can broadcast
    /// GameOver(Forfeited) to the room. A no-op (room unchanged) if there's
    /// no ActiveGame or `leavingPlayerId` isn't part of it.
    let forfeitGame (leavingPlayerId: PlayerId) (room: Room) =
        if isInActiveGame leavingPlayerId room then endGame room else room

    /// Records that `playerId` just disconnected, at `at`. The player
    /// stays in Players (still visible/targetable) until a later sweep
    /// removes them for real — see removeStaleDisconnections.
    let markDisconnected (playerId: PlayerId) (at: DateTimeOffset) (room: Room) =
        { room with DisconnectedPlayers = room.DisconnectedPlayers |> Map.add playerId at }

    /// Un-marks `playerId` as disconnected, if it was — for a player who
    /// reconnects before the sweep catches up to them.
    let markReconnected (playerId: PlayerId) (room: Room) =
        { room with DisconnectedPlayers = room.DisconnectedPlayers |> Map.remove playerId }

    /// Removes every player in `idsToRemove` from the room entirely —
    /// dropped from Players/DisconnectedPlayers, along with any play
    /// requests they sent or received (a request naming a removed player
    /// is meaningless to keep around). If any of them was in the room's
    /// ActiveGame, that game is also ended (forfeited) — the opponent, if
    /// any, is freed up to send/accept new requests immediately rather
    /// than being stuck "in a game" against someone who no longer exists.
    /// Returns the updated room and the surviving opponent's PlayerId if
    /// a game was forfeited this way (None if no game was affected, or if
    /// both players in it were removed at once). Shared by
    /// removeStaleDisconnections (the periodic sweep) and prepareJoin
    /// (freeing up a disconnected player's name for their own reconnect).
    let private removePlayers (idsToRemove: Set<PlayerId>) (room: Room) : Room * PlayerId option =
        if idsToRemove.IsEmpty then
            room, None
        else
            let affectedGame =
                room.ActiveGame
                |> Option.filter (fun s -> idsToRemove.Contains s.PlayerA || idsToRemove.Contains s.PlayerB)

            let forfeitedOpponent =
                affectedGame
                |> Option.bind (fun s ->
                    let opponent = if idsToRemove.Contains s.PlayerA then s.PlayerB else s.PlayerA
                    if idsToRemove.Contains opponent then None else Some opponent)

            let updated =
                { room with
                    Players = room.Players |> List.filter (fun p -> not (idsToRemove.Contains p.Id))
                    DisconnectedPlayers = room.DisconnectedPlayers |> Map.filter (fun id _ -> not (idsToRemove.Contains id))
                    PendingRequests =
                        room.PendingRequests
                        |> List.filter (fun r -> not (idsToRemove.Contains r.FromPlayerId) && not (idsToRemove.Contains r.ToPlayerId))
                    ActiveGame = if affectedGame.IsSome then None else room.ActiveGame }

            updated, forfeitedOpponent

    /// Removes every player who's been disconnected since before `cutoff`
    /// (i.e. DisconnectedAt < cutoff — call with `DateTimeOffset.UtcNow -
    /// disconnectGracePeriod`). Returns the updated room, the ids removed
    /// (for the caller to broadcast PlayerLeft for each), and the
    /// surviving opponent's PlayerId if a game was forfeited this way —
    /// see removePlayers.
    let removeStaleDisconnections (cutoff: DateTimeOffset) (room: Room) : Room * PlayerId list * PlayerId option =
        let staleIds =
            room.DisconnectedPlayers
            |> Map.filter (fun _ disconnectedAt -> disconnectedAt < cutoff)
            |> Map.toList
            |> List.map fst
            |> Set.ofList

        let updated, forfeitedOpponent = removePlayers staleIds room
        updated, staleIds |> Set.toList, forfeitedOpponent

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
        | Some _ -> Error ()

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
    /// the updated room and the surviving opponent's PlayerId if `playerId`
    /// was mid-game (None if not, or if they had no active game) — same
    /// shape as removeStaleDisconnections, for the same reason (the caller
    /// broadcasts PlayerLeft/GameOver(Forfeited) exactly the same way
    /// either removal path does). A no-op (unchanged room, no opponent)
    /// if `playerId` isn't actually in the room.
    let leave (playerId: PlayerId) (room: Room) : Room * PlayerId option =
        removePlayers (Set.singleton playerId) room
