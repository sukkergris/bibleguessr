namespace BibleGuessr.Domain

open System

/// A player taking part in a Congregation — the name travels with the id so
/// someone who leaves mid-game stays on the leaderboard under their own
/// name, even after the room has forgotten them (see docs/web/congregation).
type Participant = { Id: PlayerId; Name: string }

/// The configurable limits of a Congregation game (see
/// "Congregation:*" in Program.fs and docs/web/congregation). The time
/// limit is a plain TimeSpan range rather than a TimeLimit: a Congregation
/// always has one, so "unlimited" must not be representable here.
type CongregationRules =
    { MinPlayers: int
      MaxPlayers: int
      MinTimeLimit: TimeSpan
      MaxTimeLimit: TimeSpan
      /// How long a scored round stays revealed before the next verse is
      /// drawn — long enough for a room watching a projector to see who
      /// got it right.
      RevealPause: TimeSpan }

module CongregationRules =
    let defaultMinPlayers = 3
    let defaultMaxPlayers = 20
    let defaultMinTimeLimitSeconds = 10
    let defaultMaxTimeLimitSeconds = 60
    let defaultRevealSeconds = 5

    /// Two players is already a duel, so a Congregation can be configured
    /// down to two (handy for manual testing) but never below.
    let smallestAllowedMinPlayers = 2

    let defaults =
        { MinPlayers = defaultMinPlayers
          MaxPlayers = defaultMaxPlayers
          MinTimeLimit = TimeSpan.FromSeconds(float defaultMinTimeLimitSeconds)
          MaxTimeLimit = TimeSpan.FromSeconds(float defaultMaxTimeLimitSeconds)
          RevealPause = TimeSpan.FromSeconds(float defaultRevealSeconds) }

    let minPlayersKey = "Congregation:MinPlayers"
    let maxPlayersKey = "Congregation:MaxPlayers"
    let minTimeLimitKey = "Congregation:MinTimeLimitSeconds"
    let maxTimeLimitKey = "Congregation:MaxTimeLimitSeconds"
    let revealKey = "Congregation:RevealSeconds"

    /// Reads the rules from configuration (`get` returns a raw setting by
    /// key, None when unset), falling back to `defaults` per setting.
    /// Fails — so the server refuses to start — on a value that isn't a
    /// whole number or on a combination no game could satisfy.
    let fromConfig (get: string -> string option) : Result<CongregationRules, string> =
        let read key fallback =
            match get key with
            | None -> Ok fallback
            | Some raw ->
                match Int32.TryParse raw with
                | true, value -> Ok value
                | false, _ -> Error $"{key} must be a whole number, got '{raw}'"

        match
            read minPlayersKey defaultMinPlayers,
            read maxPlayersKey defaultMaxPlayers,
            read minTimeLimitKey defaultMinTimeLimitSeconds,
            read maxTimeLimitKey defaultMaxTimeLimitSeconds,
            read revealKey defaultRevealSeconds
        with
        | Error e, _, _, _, _
        | _, Error e, _, _, _
        | _, _, Error e, _, _
        | _, _, _, Error e, _
        | _, _, _, _, Error e -> Error e
        | Ok minPlayers, Ok maxPlayers, Ok minTime, Ok maxTime, Ok reveal ->
            if minPlayers < smallestAllowedMinPlayers then
                Error $"{minPlayersKey} must be at least {smallestAllowedMinPlayers}"
            elif maxPlayers < minPlayers then
                Error $"{maxPlayersKey} must be at least {minPlayersKey}"
            elif minTime <= 0 then
                Error $"{minTimeLimitKey} must be positive"
            elif maxTime < minTime then
                Error $"{maxTimeLimitKey} must be at least {minTimeLimitKey}"
            elif reveal < 0 then
                Error $"{revealKey} must not be negative"
            else
                Ok
                    { MinPlayers = minPlayers
                      MaxPlayers = maxPlayers
                      MinTimeLimit = TimeSpan.FromSeconds(float minTime)
                      MaxTimeLimit = TimeSpan.FromSeconds(float maxTime)
                      RevealPause = TimeSpan.FromSeconds(float reveal) }

/// An open Congregation lobby: the host has picked the settings and room
/// members opt in until the host starts the game. Members are kept in join
/// order and always include the host, first.
type CongregationLobby =
    { Host: Participant
      Members: Participant list
      GameType: GameType
      RoundCount: int
      RoundTimeLimit: TimeSpan }

/// Why a lobby action was refused. The hub turns each case into the
/// message the caller sees.
type LobbyError =
    /// A duel is running, or a lobby/Congregation already exists.
    | RoomBusy
    | RoundCountOutOfRange
    | TimeLimitOutOfRange
    | LobbyFull
    | NoLobby
    | NotHost
    | NotAMember
    | TooFewPlayers of have: int * need: int

module CongregationLobby =
    /// Same 3-10 vocabulary as the round-count slider every other mode
    /// uses (see frontend/src/game-preferences.ts).
    let minRoundCount = 3
    let maxRoundCount = 10

    let create
        (rules: CongregationRules)
        (host: Participant)
        (gameType: GameType)
        (roundCount: int)
        (timeLimit: TimeSpan)
        : Result<CongregationLobby, LobbyError> =
        if roundCount < minRoundCount || roundCount > maxRoundCount then
            Error RoundCountOutOfRange
        elif timeLimit < rules.MinTimeLimit || timeLimit > rules.MaxTimeLimit then
            Error TimeLimitOutOfRange
        else
            Ok
                { Host = host
                  Members = [ host ]
                  GameType = gameType
                  RoundCount = roundCount
                  RoundTimeLimit = timeLimit }

    let isMember (playerId: PlayerId) (lobby: CongregationLobby) =
        lobby.Members |> List.exists (fun m -> m.Id = playerId)

    /// Joining twice is harmless: an existing member is simply still a
    /// member, even when the lobby is full.
    let join (rules: CongregationRules) (participant: Participant) (lobby: CongregationLobby) =
        if isMember participant.Id lobby then Ok lobby
        elif lobby.Members.Length >= rules.MaxPlayers then Error LobbyFull
        else Ok { lobby with Members = lobby.Members @ [ participant ] }

    let leave (playerId: PlayerId) (lobby: CongregationLobby) =
        { lobby with Members = lobby.Members |> List.filter (fun m -> m.Id <> playerId) }

    /// The members who will actually play if the game starts now: only
    /// the connected ones, since nobody can join after the start and a
    /// player who is offline at that moment would only be a dead seat.
    let startingMembers (rules: CongregationRules) (isConnected: PlayerId -> bool) (lobby: CongregationLobby) =
        let connected = lobby.Members |> List.filter (fun m -> isConnected m.Id)

        if connected.Length < rules.MinPlayers then
            Error(TooFewPlayers(connected.Length, rules.MinPlayers))
        else
            Ok connected
