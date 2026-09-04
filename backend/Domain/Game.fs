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
type Guess =
    { PlayerId: PlayerId
      Book: string
      Chapter: int option
      VerseNumber: int option
      SubmittedAt: DateTimeOffset }

/// Result of scoring one player's guess against the round's actual verse.
type GuessResult =
    { PlayerId: PlayerId
      Correct: bool
      PointsAwarded: int }

type RoundState =
    | WaitingForPlayers
    | InProgress of Verse
    | Scored of Verse * GuessResult list

/// A chat message sent within a room. Not persisted to disk — kept only in
/// memory as part of the room's RecentMessages, same lifetime as the room
/// itself (lost on server restart, same as everything else about a Room).
type ChatMessage =
    { PlayerId: PlayerId
      PlayerName: string
      Text: string
      SentAt: DateTimeOffset }

/// A "start a game" invite one player sends another, by clicking their name
/// in the room's players list (see docs/SCRUM/Feature.StartMPGame.md). Only
/// send/see/withdraw are in scope for this feature — accepting a request to
/// actually start a synced game depends on round sync, which doesn't exist
/// yet, so there's deliberately no accept/decline here.
type PlayRequest =
    { FromPlayerId: PlayerId
      FromPlayerName: string
      ToPlayerId: PlayerId
      SentAt: DateTimeOffset }

type Room =
    { Code: RoomCode
      Players: Player list
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
      DisconnectedPlayers: Map<PlayerId, DateTimeOffset> }

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
          DisconnectedPlayers = Map.empty }

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

    /// All requests currently addressed to `toPlayerId`.
    let pendingRequestsFor (toPlayerId: PlayerId) (room: Room) =
        room.PendingRequests |> List.filter (fun r -> r.ToPlayerId = toPlayerId)

    /// Records that `playerId` just disconnected, at `at`. The player
    /// stays in Players (still visible/targetable) until a later sweep
    /// removes them for real — see removeStaleDisconnections.
    let markDisconnected (playerId: PlayerId) (at: DateTimeOffset) (room: Room) =
        { room with DisconnectedPlayers = room.DisconnectedPlayers |> Map.add playerId at }

    /// Un-marks `playerId` as disconnected, if it was — for a player who
    /// reconnects before the sweep catches up to them.
    let markReconnected (playerId: PlayerId) (room: Room) =
        { room with DisconnectedPlayers = room.DisconnectedPlayers |> Map.remove playerId }

    /// Removes every player who's been disconnected since before `cutoff`
    /// (i.e. DisconnectedAt < cutoff — call with `DateTimeOffset.UtcNow -
    /// disconnectGracePeriod`), along with any play requests they sent or
    /// received (a request naming a since-removed player is meaningless to
    /// keep around). Returns the updated room plus the ids of everyone
    /// removed, so the caller can broadcast PlayerLeft for each.
    let removeStaleDisconnections (cutoff: DateTimeOffset) (room: Room) =
        let staleIds =
            room.DisconnectedPlayers
            |> Map.filter (fun _ disconnectedAt -> disconnectedAt < cutoff)
            |> Map.toList
            |> List.map fst
            |> Set.ofList

        if staleIds.IsEmpty then
            room, []
        else
            let updated =
                { room with
                    Players = room.Players |> List.filter (fun p -> not (staleIds.Contains p.Id))
                    DisconnectedPlayers = room.DisconnectedPlayers |> Map.filter (fun id _ -> not (staleIds.Contains id))
                    PendingRequests =
                        room.PendingRequests
                        |> List.filter (fun r -> not (staleIds.Contains r.FromPlayerId) && not (staleIds.Contains r.ToPlayerId)) }

            updated, staleIds |> Set.toList

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

    let isCorrectGuess (verse: Verse) (guess: Guess) =
        let bookMatches =
            String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

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

    let pointsForVerseGuess (verse: Verse) (guess: Guess) =
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
