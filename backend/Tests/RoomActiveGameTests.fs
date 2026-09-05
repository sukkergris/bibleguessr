module BibleGuessr.Tests.RoomActiveGameTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayerId () = PlayerId(Guid.NewGuid())

let private makeVerse book chapter verseNumber : VerseReference =
    { Book = book; BookNumber = 0; Chapter = chapter; VerseNumber = verseNumber }

let private makeRequest fromId toId : PlayRequest =
    { FromPlayerId = fromId
      FromPlayerName = "someone"
      ToPlayerId = toId
      GameType = AllVerses
      RoundCount = 5
      RoundTimeLimit = Unlimited
      SentAt = DateTimeOffset.UtcNow }

let private makePlayer name : Player =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

let private someVerse = makeVerse "John" 3 16
let private someTime = DateTimeOffset.UtcNow

[<Fact>]
let ``isInActiveGame is true for either player in the active session`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime (Room.sendPlayRequest (makeRequest playerA playerB) room)

    Assert.True(Room.isInActiveGame playerA room)
    Assert.True(Room.isInActiveGame playerB room)

[<Fact>]
let ``isInActiveGame is false for a player not in the active session`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let stranger = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime (Room.sendPlayRequest (makeRequest playerA playerB) room)

    Assert.False(Room.isInActiveGame stranger room)

[<Fact>]
let ``isInActiveGame is false when there is no active game`` () =
    let room = Room.create (RoomCode "1234")

    Assert.False(Room.isInActiveGame (makePlayerId ()) room)

[<Fact>]
let ``acceptPlayRequest starts a game and removes the request`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest playerA playerB) room

    let updated, accepted = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime room

    Assert.Empty(updated.PendingRequests)
    Assert.True(accepted.IsSome)

    match updated.ActiveGame with
    | Some session ->
        Assert.Equal(playerA, session.PlayerA)
        Assert.Equal(playerB, session.PlayerB)
    | None -> failwith "expected an ActiveGame"

[<Fact>]
let ``acceptPlayRequest is a no-op when the request no longer exists`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room = Room.create (RoomCode "1234")

    let updated, accepted = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime room

    Assert.True(accepted.IsNone)
    Assert.True(updated.ActiveGame.IsNone)

[<Fact>]
let ``updateGame is a no-op when there is no active game`` () =
    let room = Room.create (RoomCode "1234")

    let updated = Room.updateGame (fun s -> { s with RoundIndex = s.RoundIndex + 1 }) room

    Assert.True(updated.ActiveGame.IsNone)

[<Fact>]
let ``endGame clears ActiveGame`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest playerA playerB) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime room

    let updated = Room.endGame room

    Assert.True(updated.ActiveGame.IsNone)

[<Fact>]
let ``forfeitGame ends the game when the leaving player is part of it`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest playerA playerB) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime room

    let updated = Room.forfeitGame playerA room

    Assert.True(updated.ActiveGame.IsNone)

[<Fact>]
let ``forfeitGame is a no-op when the leaving player isn't in the active game`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let stranger = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest playerA playerB) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime room

    let updated = Room.forfeitGame stranger room

    Assert.True(updated.ActiveGame.IsSome)

[<Fact>]
let ``removeStaleDisconnections ends the ActiveGame when one participant is removed`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB ] }

    let room = Room.sendPlayRequest (makeRequest playerA.Id playerB.Id) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA.Id playerB.Id someVerse someTime room
    let room = Room.markDisconnected playerA.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, _, _ = Room.removeStaleDisconnections cutoff room

    Assert.True(updated.ActiveGame.IsNone)

[<Fact>]
let ``removeStaleDisconnections returns the surviving opponent when one participant is removed`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB ] }

    let room = Room.sendPlayRequest (makeRequest playerA.Id playerB.Id) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA.Id playerB.Id someVerse someTime room
    let room = Room.markDisconnected playerA.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let _, _, forfeitedOpponent = Room.removeStaleDisconnections cutoff room

    Assert.Equal(Some playerB.Id, forfeitedOpponent)

[<Fact>]
let ``removeStaleDisconnections returns no opponent when both participants are removed`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB ] }

    let room = Room.sendPlayRequest (makeRequest playerA.Id playerB.Id) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA.Id playerB.Id someVerse someTime room
    let room = Room.markDisconnected playerA.Id disconnectedAt room
    let room = Room.markDisconnected playerB.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let _, _, forfeitedOpponent = Room.removeStaleDisconnections cutoff room

    Assert.True(forfeitedOpponent.IsNone)

[<Fact>]
let ``removeStaleDisconnections leaves ActiveGame untouched when neither participant is stale`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let bystander = makePlayer "Carol"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB; bystander ] }

    let room = Room.sendPlayRequest (makeRequest playerA.Id playerB.Id) room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA.Id playerB.Id someVerse someTime room
    let room = Room.markDisconnected bystander.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, _, forfeitedOpponent = Room.removeStaleDisconnections cutoff room

    Assert.True(updated.ActiveGame.IsSome)
    Assert.True(forfeitedOpponent.IsNone)
