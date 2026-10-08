module BibleGuessr.Tests.LeaderboardTests

// The spectator board — see Leaderboard.fs and docs/web/congregation.
// Anyone with the link can watch, so these tests pin down what it may
// show: never the reference of a round still being guessed, and never
// what anyone guessed.

open System
open System.Text.Json
open Xunit
open BibleGuessr.Domain

let private rules = CongregationRules.defaults
let private now = DateTimeOffset.UtcNow
let private timeLimit = TimeSpan.FromSeconds 30.0

// A distinctive book name, so a leak would be unmistakable in the JSON.
let private verse: VerseReference = { Book = "Habakkuk"; BookNumber = 35; Chapter = 2; VerseNumber = 4 }

let private makePlayer name : Player =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

let private alice, bob, carol = makePlayer "Alice", makePlayer "Bob", makePlayer "Carol"

let private ok result =
    match result with
    | Ok value -> value
    | Error e -> failwith $"expected Ok, got %A{e}"

let private playing () =
    let players = [ alice; bob; carol ]
    let room = { Room.create (RoomCode "1234") with Players = players }
    let asParticipant (p: Player) = { Id = p.Id; Name = p.Name }

    let room, _ =
        Room.openCongregation rules (asParticipant alice) AllVerses 3 timeLimit room
        |> ok

    let room =
        [ bob; carol ]
        |> List.fold (fun r p -> Room.joinCongregation rules (asParticipant p) r |> ok) room

    let room, game =
        Room.startCongregation rules alice.Id (GameId(Guid.NewGuid())) verse now room
        |> ok

    room, game.Session.GameId

let private guess (playerId: PlayerId) book : Guess =
    { PlayerId = playerId
      Book = book
      BookNumber = None
      Chapter = Some 2
      VerseNumber = Some 4
      SubmittedAt = now }

let private toJson (snapshot: LeaderboardSnapshot) =
    let options = JsonSerializerOptions()
    options.Converters.Add(BibleGuessr.Api.Json.converter ())
    JsonSerializer.Serialize(snapshot, options)

[<Fact>]
let ``a round being guessed is not revealed on the board`` () =
    let room, gameId = playing ()
    let room = Room.updateGame gameId (GameSession.submitGuess bob.Id (guess bob.Id "Obadiah")) room

    // Lower-cased, so the check holds whatever naming policy the hub's
    // serializer applies (SignalR camel-cases).
    let json = (toJson (Leaderboard.ofRoom rules room)).ToLowerInvariant()

    Assert.DoesNotContain("habakkuk", json)
    Assert.DoesNotContain("booknumber", json)
    Assert.DoesNotContain("versenumber", json)
    Assert.DoesNotContain("\"chapter\"", json)
    // Nor what anyone guessed.
    Assert.DoesNotContain("obadiah", json)

[<Fact>]
let ``a round being guessed shows its number and deadline`` () =
    let room, _ = playing ()

    let board = Leaderboard.ofRoom rules room

    Assert.Equal(Playing, board.Phase)
    Assert.Equal(Guessing(1, now + timeLimit), board.Round)

[<Fact>]
let ``the board shows who has guessed, never what`` () =
    let room, gameId = playing ()
    let room = Room.updateGame gameId (GameSession.submitGuess bob.Id (guess bob.Id "Obadiah")) room

    let board = Leaderboard.ofRoom rules room
    let guessed = board.Entries |> List.filter (fun e -> e.GuessedThisRound) |> List.map (fun e -> e.Name)

    Assert.Equal<string list>([ "Bob" ], guessed)
    Assert.All(board.Entries, (fun e -> Assert.True(e.PointsThisRound.IsNone)))

[<Fact>]
let ``a scored round reveals its reference and points`` () =
    let room, gameId = playing ()

    let room =
        Room.updateGame
            gameId
            (GameSession.submitGuess alice.Id (guess alice.Id "Habakkuk")
             >> GameSession.scoreRound now)
            room

    let board = Leaderboard.ofRoom rules room
    let aliceRow = board.Entries |> List.find (fun e -> e.Name = "Alice")

    Assert.Equal(Revealed(1, verse), board.Round)
    // The same serializer does carry a revealed reference — so the
    // absence checked in the guessing test above is meaningful.
    Assert.Contains("habakkuk", (toJson board).ToLowerInvariant())
    Assert.Equal(Some 1110, aliceRow.PointsThisRound)
    Assert.Equal(1, aliceRow.Rank)

[<Fact>]
let ``equal scores share a rank and the next rank skips`` () =
    let ranked = Leaderboard.rank [ "a", 10; "b", 8; "c", 8; "d", 5 ]

    Assert.Equal<(string * int * int) list>([ "a", 10, 1; "b", 8, 2; "c", 8, 2; "d", 5, 4 ], ranked)

[<Fact>]
let ``a participant who left stays ranked, marked as left`` () =
    let room, gameId = playing ()
    let room = Room.updateGame gameId (fun s -> { s with Scores = s.Scores.Add(bob.Id, 500) }) room
    let room, _ = Room.leave bob.Id room

    let board = Leaderboard.ofRoom rules room
    let bobRow = board.Entries |> List.find (fun e -> e.Name = "Bob")

    Assert.Equal(Left, bobRow.Status)
    Assert.Equal(1, bobRow.Rank)

[<Fact>]
let ``a disconnected participant is marked as disconnected`` () =
    let room, _ = playing ()
    let room = Room.markDisconnected carol.Id now room

    let board = Leaderboard.ofRoom rules room

    Assert.Equal(Disconnected, (board.Entries |> List.find (fun e -> e.Name = "Carol")).Status)

[<Fact>]
let ``a finished game stays on the board until the next lobby opens`` () =
    let room, gameId = playing ()
    let ended = Room.endGame gameId room

    Assert.Equal(Finished, (Leaderboard.ofRoom rules ended).Phase)

    let reopened, _ =
        Room.openCongregation rules { Id = bob.Id; Name = "Bob" } AllVerses 3 timeLimit ended
        |> ok

    Assert.Equal(LobbyOpen, (Leaderboard.ofRoom rules reopened).Phase)

[<Fact>]
let ``a room without a Congregation has an empty board`` () =
    let board = Leaderboard.ofRoom rules (Room.create (RoomCode "1234"))

    Assert.Equal(NoCongregation, board.Phase)
    Assert.Empty(board.Entries)
