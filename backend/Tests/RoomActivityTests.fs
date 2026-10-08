module BibleGuessr.Tests.RoomActivityTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayerId () = PlayerId(Guid.NewGuid())

let private someVerse: VerseReference =
    { Book = "John"; BookNumber = 0; Chapter = 3; VerseNumber = 16 }

let private someTime = DateTimeOffset.UtcNow

let private makeRequest fromId toId : PlayRequest =
    { FromPlayerId = fromId
      FromPlayerName = "someone"
      ToPlayerId = toId
      GameType = AllVerses
      RoundCount = 5
      RoundTimeLimit = Unlimited
      SentAt = someTime }

let private acceptDuel fromId toId room =
    room
    |> Room.sendPlayRequest (makeRequest fromId toId)
    |> Room.acceptPlayRequest (GameId(Guid.NewGuid())) fromId toId someVerse someTime
    |> fst

// Regression: a second duel in the same room used to replace the first
// one's session silently, because the guard only checked the two players
// starting the new game.
[<Fact>]
let ``a second duel in the same room does not overwrite the first`` () =
    let a, b, c, d = makePlayerId (), makePlayerId (), makePlayerId (), makePlayerId ()

    let room = Room.create (RoomCode "1234") |> acceptDuel a b |> acceptDuel c d

    Assert.True(Room.isInActiveGame a room)
    Assert.True(Room.isInActiveGame b room)
    Assert.True(Room.isInActiveGame c room)
    Assert.True(Room.isInActiveGame d room)

[<Fact>]
let ``finishing one duel leaves the other running`` () =
    let a, b, c, d = makePlayerId (), makePlayerId (), makePlayerId (), makePlayerId ()
    let room = Room.create (RoomCode "1234") |> acceptDuel a b |> acceptDuel c d
    let first = (Room.gameOf a room).Value.GameId

    let afterFirst = Room.endGame first room

    Assert.False(Room.isInActiveGame a afterFirst)
    Assert.True(Room.isInActiveGame c afterFirst)

[<Fact>]
let ``a player already in a duel cannot start a second one`` () =
    let a, b, c = makePlayerId (), makePlayerId (), makePlayerId ()
    let room = Room.create (RoomCode "1234") |> acceptDuel a b

    let updated = room |> acceptDuel a c

    Assert.Equal(1, (Room.games updated).Length)
    Assert.False(Room.isInActiveGame c updated)

let private rules = CongregationRules.defaults
let private host = { Id = makePlayerId (); Name = "Host" }
let private aMinute = TimeSpan.FromSeconds 30.0

let private openLobby room =
    Room.openCongregation rules host AllVerses 5 aMinute room

[<Fact>]
let ``a Congregation lobby cannot open while a duel runs`` () =
    let room = Room.create (RoomCode "1234") |> acceptDuel (makePlayerId ()) (makePlayerId ())

    Assert.Equal(Error RoomBusy, openLobby room |> Result.map ignore)

[<Fact>]
let ``no duel can start while a Congregation lobby is open`` () =
    let a, b = makePlayerId (), makePlayerId ()

    match openLobby (Room.create (RoomCode "1234")) with
    | Ok(room, _) ->
        let updated = room |> acceptDuel a b
        Assert.False(Room.isInActiveGame a updated)
        Assert.False(Room.allowsDuels updated)
    | Error e -> failwith $"expected the lobby to open, got %A{e}"

[<Fact>]
let ``nobody can join matchmaking while a Congregation lobby is open`` () =
    let a = makePlayerId ()

    let entry =
        { PlayerId = a
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          WaitingSince = someTime }

    match openLobby (Room.create (RoomCode "1234")) with
    | Ok(room, _) -> Assert.False(Room.isWaitingForMatch a (Room.joinMatchmaking entry room))
    | Error e -> failwith $"expected the lobby to open, got %A{e}"

[<Fact>]
let ``opening a lobby drops pending requests and the matchmaking queue`` () =
    let a, b, c = makePlayerId (), makePlayerId (), makePlayerId ()
    let request = makeRequest a b

    let entry =
        { PlayerId = c
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          WaitingSince = someTime }

    let room =
        { Room.create (RoomCode "1234") with
            Players =
                [ { Id = c; Name = "Carol"; Score = 0 } ] }
        |> Room.sendPlayRequest request
        |> Room.joinMatchmaking entry

    match openLobby room with
    | Ok(opened, dropped) ->
        Assert.Equal<PlayRequest list>([ request ], dropped)
        Assert.Empty(opened.PendingRequests)
        Assert.Empty(opened.WaitingForMatch)
    | Error e -> failwith $"expected the lobby to open, got %A{e}"
