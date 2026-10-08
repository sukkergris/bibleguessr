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

/// Accepts a fresh request from `playerA` to `playerB`, returning the room
/// and the started game's id.
let private startDuel playerA playerB room =
    let gameId = GameId(Guid.NewGuid())
    let room, _ = Room.acceptPlayRequest gameId playerA playerB someVerse someTime (Room.sendPlayRequest (makeRequest playerA playerB) room)
    room, gameId

[<Fact>]
let ``isInActiveGame is true for either player in the duel`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room, _ = startDuel playerA playerB (Room.create (RoomCode "1234"))

    Assert.True(Room.isInActiveGame playerA room)
    Assert.True(Room.isInActiveGame playerB room)

[<Fact>]
let ``isInActiveGame is false for a player not in any duel`` () =
    let room, _ = startDuel (makePlayerId ()) (makePlayerId ()) (Room.create (RoomCode "1234"))

    Assert.False(Room.isInActiveGame (makePlayerId ()) room)

[<Fact>]
let ``isInActiveGame is false when there is no game`` () =
    let room = Room.create (RoomCode "1234")

    Assert.False(Room.isInActiveGame (makePlayerId ()) room)

[<Fact>]
let ``acceptPlayRequest starts a duel and removes the request`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest playerA playerB) room

    let updated, started = Room.acceptPlayRequest (GameId(Guid.NewGuid())) playerA playerB someVerse someTime room

    Assert.Empty(updated.PendingRequests)

    match started, Room.games updated with
    | Some session, [ running ] ->
        Assert.Equal(session, running)
        Assert.Equal<PlayerId list>([ playerA; playerB ], running.Participants)
        Assert.Equal(Duel, running.Format)
    | _ -> failwith "expected exactly one running duel"

[<Fact>]
let ``acceptPlayRequest is a no-op when the request no longer exists`` () =
    let room = Room.create (RoomCode "1234")

    let updated, started = Room.acceptPlayRequest (GameId(Guid.NewGuid())) (makePlayerId ()) (makePlayerId ()) someVerse someTime room

    Assert.True(started.IsNone)
    Assert.Empty(Room.games updated)

[<Fact>]
let ``updateGame is a no-op when there is no such game`` () =
    let room, _ = startDuel (makePlayerId ()) (makePlayerId ()) (Room.create (RoomCode "1234"))

    let updated = Room.updateGame (GameId(Guid.NewGuid())) (fun s -> { s with RoundIndex = s.RoundIndex + 1 }) room

    Assert.Equal(room, updated)

[<Fact>]
let ``endGame removes only that game`` () =
    let room, first = startDuel (makePlayerId ()) (makePlayerId ()) (Room.create (RoomCode "1234"))
    let room, second = startDuel (makePlayerId ()) (makePlayerId ()) room

    let updated = Room.endGame first room

    Assert.Equal<GameId list>([ second ], Room.games updated |> List.map (fun s -> s.GameId))

[<Fact>]
let ``forfeitGame ends the duel when the leaving player is part of it`` () =
    let playerA = makePlayerId ()
    let room, _ = startDuel playerA (makePlayerId ()) (Room.create (RoomCode "1234"))

    let updated = Room.forfeitGame playerA room

    Assert.Empty(Room.games updated)

[<Fact>]
let ``forfeitGame is a no-op when the leaving player isn't in a duel`` () =
    let room, _ = startDuel (makePlayerId ()) (makePlayerId ()) (Room.create (RoomCode "1234"))

    let updated = Room.forfeitGame (makePlayerId ()) room

    Assert.Equal(1, (Room.games updated).Length)

[<Fact>]
let ``removeStaleDisconnections forfeits the duel to the surviving opponent`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB ] }

    let room, _ = startDuel playerA.Id playerB.Id room
    let room = Room.markDisconnected playerA.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, _, impact = Room.removeStaleDisconnections cutoff room

    Assert.Empty(Room.games updated)

    match impact with
    | DuelsForfeited [ _, survivor ] -> Assert.Equal(Some playerB.Id, survivor)
    | other -> failwith $"expected one forfeited duel, got %A{other}"

[<Fact>]
let ``removeStaleDisconnections names no survivor when both duel players are removed`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB ] }

    let room, _ = startDuel playerA.Id playerB.Id room
    let room = Room.markDisconnected playerA.Id disconnectedAt room
    let room = Room.markDisconnected playerB.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let _, _, impact = Room.removeStaleDisconnections cutoff room

    match impact with
    | DuelsForfeited [ _, survivor ] -> Assert.True(survivor.IsNone)
    | other -> failwith $"expected one forfeited duel, got %A{other}"

[<Fact>]
let ``removeStaleDisconnections leaves the duel untouched when neither player is stale`` () =
    let playerA = makePlayer "Alice"
    let playerB = makePlayer "Bob"
    let bystander = makePlayer "Carol"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ playerA; playerB; bystander ] }

    let room, _ = startDuel playerA.Id playerB.Id room
    let room = Room.markDisconnected bystander.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, _, impact = Room.removeStaleDisconnections cutoff room

    Assert.Equal(1, (Room.games updated).Length)
    Assert.Equal(NothingAffected, impact)
