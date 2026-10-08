module BibleGuessr.Tests.CongregationTests

// The Congregation lifecycle in the domain: lobby, rounds, departures and
// keeping a seat on reconnect — see docs/web/congregation.

open System
open Xunit
open BibleGuessr.Domain

let private rules =
    { CongregationRules.defaults with
        MinPlayers = 3
        MaxPlayers = 4 }

let private now = DateTimeOffset.UtcNow
let private timeLimit = TimeSpan.FromSeconds 30.0
let private verse: VerseReference = { Book = "John"; BookNumber = 43; Chapter = 3; VerseNumber = 16 }

let private makePlayer name : Player =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

let private asParticipant (p: Player) = { Id = p.Id; Name = p.Name }

let private guessFor (playerId: PlayerId) : Guess =
    { PlayerId = playerId
      Book = "John"
      BookNumber = Some 43
      Chapter = Some 3
      VerseNumber = Some 16
      SubmittedAt = now }

let private ok result =
    match result with
    | Ok value -> value
    | Error e -> failwith $"expected Ok, got %A{e}"

let private roomWith (players: Player list) =
    { Room.create (RoomCode "1234") with Players = players }

/// A room with `players` in an open lobby hosted by the first of them,
/// every other player joined.
let private gathered (players: Player list) =
    let host = players.Head

    let room, _ =
        roomWith players
        |> Room.openCongregation rules (asParticipant host) AllVerses 3 timeLimit
        |> ok

    players.Tail
    |> List.fold (fun r p -> Room.joinCongregation rules (asParticipant p) r |> ok) room

/// The same, with the game started.
let private playing (players: Player list) =
    gathered players
    |> Room.startCongregation rules players.Head.Id (GameId(Guid.NewGuid())) verse now
    |> ok

let private sessionOf (room: Room) =
    match room.Activity with
    | Congregating game -> game.Session
    | other -> failwith $"expected a running Congregation, got %A{other}"

let private alice, bob, carol, dave, erin =
    makePlayer "Alice", makePlayer "Bob", makePlayer "Carol", makePlayer "Dave", makePlayer "Erin"

// ---- Lobby ----

[<Fact>]
let ``opening a lobby makes the host its first member`` () =
    match (gathered [ alice ]).Activity with
    | Gathering lobby ->
        Assert.Equal(alice.Id, lobby.Host.Id)
        Assert.Equal<Participant list>([ asParticipant alice ], lobby.Members)
    | other -> failwith $"expected a lobby, got %A{other}"

[<Theory>]
[<InlineData(2)>]
[<InlineData(11)>]
let ``a lobby refuses a round count outside 3-10`` (roundCount: int) =
    let result = Room.openCongregation rules (asParticipant alice) AllVerses roundCount timeLimit (roomWith [ alice ])

    Assert.Equal(Error RoundCountOutOfRange, result |> Result.map ignore)

[<Theory>]
[<InlineData(5)>]
[<InlineData(61)>]
let ``a lobby refuses a time limit outside the configured range`` (seconds: int) =
    let result =
        Room.openCongregation rules (asParticipant alice) AllVerses 5 (TimeSpan.FromSeconds(float seconds)) (roomWith [ alice ])

    Assert.Equal(Error TimeLimitOutOfRange, result |> Result.map ignore)

[<Fact>]
let ``only one lobby can be open at a time`` () =
    let result = Room.openCongregation rules (asParticipant bob) AllVerses 5 timeLimit (gathered [ alice; bob ])

    Assert.Equal(Error RoomBusy, result |> Result.map ignore)

[<Fact>]
let ``joining twice is harmless`` () =
    let room = gathered [ alice; bob ]

    let again = Room.joinCongregation rules (asParticipant bob) room |> ok

    Assert.Equal(room, again)

[<Fact>]
let ``a full lobby refuses another member`` () =
    let room = gathered [ alice; bob; carol; dave ]

    Assert.Equal(Error LobbyFull, Room.joinCongregation rules (asParticipant erin) room |> Result.map ignore)

[<Fact>]
let ``a member leaving the lobby keeps it open`` () =
    let room, impact = gathered [ alice; bob; carol ] |> Room.leaveCongregation bob.Id |> ok

    match room.Activity, impact with
    | Gathering lobby, LobbyMembersRemoved _ ->
        Assert.Equal<PlayerId list>([ alice.Id; carol.Id ], lobby.Members |> List.map (fun m -> m.Id))
    | other -> failwith $"expected the lobby to stay open, got %A{other}"

[<Fact>]
let ``the host leaving cancels the lobby`` () =
    let room, impact = gathered [ alice; bob ] |> Room.leaveCongregation alice.Id |> ok

    Assert.True(Room.allowsDuels room)

    match impact with
    | LobbyCanceled _ -> ()
    | other -> failwith $"expected LobbyCanceled, got %A{other}"

[<Fact>]
let ``only the host can cancel or start`` () =
    let room = gathered [ alice; bob; carol ]

    Assert.Equal(Error NotHost, Room.cancelCongregation bob.Id room |> Result.map ignore)

    Assert.Equal(
        Error NotHost,
        Room.startCongregation rules bob.Id (GameId(Guid.NewGuid())) verse now room
        |> Result.map ignore
    )

[<Fact>]
let ``starting needs the minimum number of connected members`` () =
    let room = gathered [ alice; bob; carol ] |> Room.markDisconnected carol.Id now

    let result = Room.startCongregation rules alice.Id (GameId(Guid.NewGuid())) verse now room

    Assert.Equal(Error(TooFewPlayers(2, 3)), result |> Result.map ignore)

[<Fact>]
let ``a started game includes only connected members, in join order, scored at zero`` () =
    let room =
        gathered [ alice; bob; carol; dave ]
        |> Room.markDisconnected bob.Id now
        |> Room.startCongregation rules alice.Id (GameId(Guid.NewGuid())) verse now
        |> ok
        |> fst

    let session = sessionOf room

    Assert.Equal<PlayerId list>([ alice.Id; carol.Id; dave.Id ], session.Participants)
    Assert.Equal(Congregation alice.Id, session.Format)
    Assert.All(session.Scores.Values, (fun score -> Assert.Equal(0, score)))
    Assert.Equal(LimitedTo timeLimit, session.RoundTimeLimit)
    Assert.Equal(rules.RevealPause, session.RevealPause)

[<Fact>]
let ``nobody can join after the start`` () =
    let room, _ = playing [ alice; bob; carol ]

    Assert.Equal(Error NoLobby, Room.joinCongregation rules (asParticipant dave) room |> Result.map ignore)

// ---- Rounds ----

let private allConnected (_: PlayerId) = true

[<Fact>]
let ``a round is ready once every participant has guessed`` () =
    let session =
        sessionOf (fst (playing [ alice; bob; carol ]))
        |> GameSession.submitGuess alice.Id (guessFor alice.Id)
        |> GameSession.submitGuess bob.Id (guessFor bob.Id)

    Assert.False(GameSession.allExpectedGuessed allConnected session)

    let complete = GameSession.submitGuess carol.Id (guessFor carol.Id) session
    Assert.True(GameSession.allExpectedGuessed allConnected complete)

[<Fact>]
let ``a disconnected participant who hasn't guessed does not hold up the round`` () =
    let session =
        sessionOf (fst (playing [ alice; bob; carol ]))
        |> GameSession.submitGuess alice.Id (guessFor alice.Id)
        |> GameSession.submitGuess bob.Id (guessFor bob.Id)

    Assert.True(GameSession.allExpectedGuessed (fun id -> id <> carol.Id) session)

[<Fact>]
let ``a round with nobody left to wait for is never ready early`` () =
    let session = sessionOf (fst (playing [ alice; bob; carol ]))

    Assert.False(GameSession.allExpectedGuessed (fun _ -> false) session)

[<Fact>]
let ``a duel still waits for a disconnected opponent`` () =
    let session =
        GameSession.startDuel (GameId(Guid.NewGuid())) alice.Id bob.Id AllVerses 5 Unlimited verse now
        |> GameSession.submitGuess alice.Id (guessFor alice.Id)

    Assert.False(GameSession.allExpectedGuessed (fun id -> id <> bob.Id) session)

[<Fact>]
let ``scoring a round scores every participant who guessed`` () =
    let session =
        sessionOf (fst (playing [ alice; bob; carol ]))
        |> GameSession.submitGuess alice.Id (guessFor alice.Id)
        |> GameSession.submitGuess carol.Id (guessFor carol.Id)
        |> GameSession.scoreRound now

    Assert.True(session.Scores[alice.Id] > 0)
    Assert.Equal(0, session.Scores[bob.Id])
    Assert.Equal(session.Scores[alice.Id], session.Scores[carol.Id])

[<Fact>]
let ``a scored round stays revealed for the reveal pause`` () =
    let scored = sessionOf (fst (playing [ alice; bob; carol ])) |> GameSession.scoreRound now

    Assert.False(GameSession.isRevealOver (now + rules.RevealPause - TimeSpan.FromSeconds 1.0) scored)
    Assert.True(GameSession.isRevealOver (now + rules.RevealPause) scored)

[<Fact>]
let ``a duel has no reveal pause`` () =
    let scored =
        GameSession.startDuel (GameId(Guid.NewGuid())) alice.Id bob.Id AllVerses 5 Unlimited verse now
        |> GameSession.scoreRound now

    Assert.Equal(TimeSpan.Zero, scored.RevealPause)
    Assert.True(GameSession.isRevealOver now scored)

[<Fact>]
let ``a Congregation round times out like any other`` () =
    let session = sessionOf (fst (playing [ alice; bob; carol ]))

    Assert.False(GameSession.isRoundExpired (now + timeLimit - TimeSpan.FromSeconds 1.0) session)
    Assert.True(GameSession.isRoundExpired (now + timeLimit) session)

// ---- Departures ----

[<Fact>]
let ``leaving the game keeps the score and the game goes on`` () =
    let room, _ = playing [ alice; bob; carol ]

    let room =
        room
        |> Room.updateGame (sessionOf room).GameId (fun s -> { s with Scores = s.Scores.Add(bob.Id, 1110) })

    let updated, impact = Room.leaveCongregationGame bob.Id room
    let session = sessionOf updated

    Assert.True(session.Departed.Contains bob.Id)
    Assert.Equal(1110, session.Scores[bob.Id])
    Assert.False(Room.isInActiveGame bob.Id updated)

    match impact with
    | CongregantsDeparted _ -> ()
    | other -> failwith $"expected CongregantsDeparted, got %A{other}"

[<Fact>]
let ``a participant who left can no longer guess`` () =
    let session =
        sessionOf (fst (playing [ alice; bob; carol ]))
        |> GameSession.depart bob.Id
        |> GameSession.submitGuess bob.Id (guessFor bob.Id)

    Assert.False(session.GuessesThisRound.ContainsKey bob.Id)

[<Fact>]
let ``a participant removed from the room departs the game`` () =
    let room, _ = playing [ alice; bob; carol ]

    let updated, impact = Room.leave carol.Id room

    Assert.True((sessionOf updated).Departed.Contains carol.Id)

    match impact with
    | CongregantsDeparted _ -> ()
    | other -> failwith $"expected CongregantsDeparted, got %A{other}"

[<Fact>]
let ``the last participant leaving abandons the game and frees the room`` () =
    let room, _ = playing [ alice; bob; carol ]

    let room, _ = Room.leaveCongregationGame alice.Id room
    let room, _ = Room.leaveCongregationGame bob.Id room
    let updated, impact = Room.leaveCongregationGame carol.Id room

    Assert.True(Room.allowsDuels updated)
    Assert.True(updated.LastCongregation.IsSome)

    match impact with
    | CongregationAbandoned _ -> ()
    | other -> failwith $"expected CongregationAbandoned, got %A{other}"

[<Fact>]
let ``ending the game keeps it as the last result`` () =
    let room, game = playing [ alice; bob; carol ]

    let ended = Room.endGame game.Session.GameId room

    Assert.True(Room.allowsDuels ended)
    Assert.Equal(Some game, ended.LastCongregation)

[<Fact>]
let ``a lobby member removed from the room leaves the lobby`` () =
    let updated, impact = gathered [ alice; bob; carol ] |> Room.leave bob.Id

    match updated.Activity, impact with
    | Gathering lobby, LobbyMembersRemoved _ -> Assert.False(CongregationLobby.isMember bob.Id lobby)
    | other -> failwith $"expected the lobby to stay open, got %A{other}"

[<Fact>]
let ``the host removed from the room cancels the lobby`` () =
    let updated, impact = gathered [ alice; bob ] |> Room.leave alice.Id

    Assert.True(Room.allowsDuels updated)

    match impact with
    | LobbyCanceled _ -> ()
    | other -> failwith $"expected LobbyCanceled, got %A{other}"

// ---- Keeping the seat on reconnect ----

[<Fact>]
let ``rejoining under the same name keeps the Congregation seat and score`` () =
    let room, game = playing [ alice; bob; carol ]

    let room =
        room
        |> Room.updateGame game.Session.GameId (fun s ->
            { s with Scores = s.Scores.Add(bob.Id, 110) }
            |> GameSession.submitGuess bob.Id (guessFor bob.Id))
        |> Room.markDisconnected bob.Id now

    let rejoined = makePlayer "Bob"

    match Room.admit rejoined room with
    | Ok admission ->
        let session = sessionOf admission.Room
        Assert.True(admission.Reseated)
        Assert.Equal(NothingAffected, admission.Impact)
        Assert.Equal(110, session.Scores[rejoined.Id])
        Assert.False(session.Scores.ContainsKey bob.Id)
        Assert.Equal(rejoined.Id, session.GuessesThisRound[rejoined.Id].PlayerId)
        Assert.True(GameSession.isActiveParticipant rejoined.Id session)
        Assert.DoesNotContain(bob, admission.Room.Players)
        Assert.Contains(rejoined, admission.Room.Players)

        match admission.Room.Activity with
        | Congregating g -> Assert.Contains({ Id = rejoined.Id; Name = "Bob" }, g.Roster)
        | _ -> failwith "expected a running Congregation"
    | Error() -> failwith "expected the rejoin to be admitted"

[<Fact>]
let ``the host rejoining keeps the host role`` () =
    let room, _ = playing [ alice; bob; carol ]
    let room = Room.markDisconnected alice.Id now room
    let rejoined = makePlayer "Alice"

    match Room.admit rejoined room with
    | Ok admission -> Assert.Equal(Congregation rejoined.Id, (sessionOf admission.Room).Format)
    | Error() -> failwith "expected the rejoin to be admitted"

[<Fact>]
let ``a duel player rejoining still forfeits their duel`` () =
    let request: PlayRequest =
        { FromPlayerId = alice.Id
          FromPlayerName = alice.Name
          ToPlayerId = bob.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = now }

    let room, _ =
        roomWith [ alice; bob ]
        |> Room.sendPlayRequest request
        |> Room.acceptPlayRequest (GameId(Guid.NewGuid())) alice.Id bob.Id verse now

    let room = Room.markDisconnected alice.Id now room

    match Room.admit (makePlayer "Alice") room with
    | Ok admission ->
        Assert.False(admission.Reseated)
        Assert.Empty(Room.games admission.Room)
    | Error() -> failwith "expected the rejoin to be admitted"

[<Fact>]
let ``admit still refuses a name held by a connected player`` () =
    let room, _ = playing [ alice; bob; carol ]

    Assert.Equal(Error(), Room.admit (makePlayer "Bob") room |> Result.map ignore)
