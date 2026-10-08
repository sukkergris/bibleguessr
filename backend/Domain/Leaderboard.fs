namespace BibleGuessr.Domain

open System

/// Where the Congregation's current round stands, as the spectator board
/// may show it. `Guessing` deliberately has no field for the verse: the
/// board is open to anyone with the link, and a reference shown while the
/// round is still being guessed would let the room shout out the answer.
/// The type makes that leak impossible rather than merely avoided.
type BoardRound =
    | NotStarted
    | Guessing of roundNumber: int * deadline: DateTimeOffset
    | Revealed of roundNumber: int * reference: VerseReference

type EntryStatus =
    | Active
    | Disconnected
    | Left

/// One row of the board. Only WHETHER someone has guessed is shown, never
/// what they guessed.
type BoardEntry =
    { PlayerId: PlayerId
      Name: string
      Score: int
      /// Standard competition ranking: equal scores share a rank and the
      /// next rank skips (1, 2, 2, 4).
      Rank: int
      Status: EntryStatus
      GuessedThisRound: bool
      /// Points from the round just revealed; None while guessing, or for
      /// a participant who didn't guess it.
      PointsThisRound: int option }

type BoardPhase =
    | NoCongregation
    | LobbyOpen
    | Playing
    | Finished

/// Everything the spectator board shows — and everything a spectator can
/// receive, since spectators get nothing but this (see GameHub.WatchRoom).
type LeaderboardSnapshot =
    { RoomCode: string
      Phase: BoardPhase
      HostName: string option
      GameType: GameType option
      RoundCount: int
      Round: BoardRound
      Entries: BoardEntry list
      MinPlayers: int
      MaxPlayers: int }

module Leaderboard =
    /// Ranks `(item, score)` pairs best-first with standard competition
    /// ranking, keeping the incoming order among equal scores.
    let rank (scored: ('a * int) list) : ('a * int * int) list =
        let ordered = scored |> List.sortByDescending snd

        ordered
        |> List.map (fun (item, score) ->
            let better = ordered |> List.filter (fun (_, s) -> s > score) |> List.length
            item, score, better + 1)

    let private boardRound (session: GameSession) =
        let roundNumber = session.RoundIndex + 1

        match session.Round, session.RoundTimeLimit, session.RoundStartedAt with
        | Scored(reference, _), _, _ -> Revealed(roundNumber, reference)
        | InProgress _, LimitedTo limit, Some startedAt -> Guessing(roundNumber, startedAt + limit)
        // A Congregation always has a time limit; a deadline of "now" is
        // a harmless fallback for an impossible case.
        | InProgress _, _, _ -> Guessing(roundNumber, session.RoundStartedAt |> Option.defaultValue DateTimeOffset.UtcNow)
        | WaitingForPlayers, _, _ -> NotStarted

    let private entries (room: Room) (game: CongregationGame) =
        let session = game.Session

        let results =
            match session.Round with
            | Scored(_, results) -> results |> List.map (fun r -> r.PlayerId, r.PointsAwarded) |> Map.ofList
            | _ -> Map.empty

        let revealed =
            match session.Round with
            | Scored _ -> true
            | _ -> false

        game.Roster
        |> List.map (fun p -> p, session.Scores |> Map.tryFind p.Id |> Option.defaultValue 0)
        |> rank
        |> List.map (fun (p, score, rank) ->
            { PlayerId = p.Id
              Name = p.Name
              Score = score
              Rank = rank
              Status =
                if session.Departed.Contains p.Id then Left
                elif room.DisconnectedPlayers.ContainsKey p.Id then Disconnected
                else Active
              GuessedThisRound = session.GuessesThisRound.ContainsKey p.Id || results.ContainsKey p.Id
              PointsThisRound =
                if revealed then
                    results |> Map.tryFind p.Id
                else
                    None })

    let private ofGame (rules: CongregationRules) (room: Room) (phase: BoardPhase) (game: CongregationGame) =
        let (RoomCode code) = room.Code

        let hostName =
            match game.Session.Format with
            | Congregation host -> game.Roster |> List.tryFind (fun p -> p.Id = host) |> Option.map (fun p -> p.Name)
            | Duel -> None

        { RoomCode = code
          Phase = phase
          HostName = hostName
          GameType = Some game.Session.GameType
          RoundCount = game.Session.RoundCount
          Round = boardRound game.Session
          Entries = entries room game
          MinPlayers = rules.MinPlayers
          MaxPlayers = rules.MaxPlayers }

    /// The spectator board for `room` right now. Pure, so what spectators
    /// can see is decided — and tested — in one place.
    let ofRoom (rules: CongregationRules) (room: Room) : LeaderboardSnapshot =
        let (RoomCode code) = room.Code

        match room.Activity, room.LastCongregation with
        | Congregating game, _ -> ofGame rules room Playing game
        | Gathering lobby, _ ->
            { RoomCode = code
              Phase = LobbyOpen
              HostName = Some lobby.Host.Name
              GameType = Some lobby.GameType
              RoundCount = lobby.RoundCount
              Round = NotStarted
              Entries =
                lobby.Members
                |> List.map (fun m ->
                    { PlayerId = m.Id
                      Name = m.Name
                      Score = 0
                      Rank = 1
                      Status = if room.DisconnectedPlayers.ContainsKey m.Id then Disconnected else Active
                      GuessedThisRound = false
                      PointsThisRound = None })
              MinPlayers = rules.MinPlayers
              MaxPlayers = rules.MaxPlayers }
        | Duels _, Some finished -> ofGame rules room Finished finished
        | Duels _, None ->
            { RoomCode = code
              Phase = NoCongregation
              HostName = None
              GameType = None
              RoundCount = 0
              Round = NotStarted
              Entries = []
              MinPlayers = rules.MinPlayers
              MaxPlayers = rules.MaxPlayers }
