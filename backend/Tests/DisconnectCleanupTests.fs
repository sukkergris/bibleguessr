module BibleGuessr.Tests.DisconnectCleanupTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayer name : Player =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

[<Fact>]
let ``markDisconnected does not remove the player from Players`` () =
    let player = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ player ] }

    let room = Room.markDisconnected player.Id DateTimeOffset.UtcNow room

    Assert.Contains(player, room.Players)
    Assert.True(room.DisconnectedPlayers.ContainsKey player.Id)

[<Fact>]
let ``markReconnected clears a pending disconnection`` () =
    let player = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ player ] }
    let room = Room.markDisconnected player.Id DateTimeOffset.UtcNow room

    let room = Room.markReconnected player.Id room

    Assert.False(room.DisconnectedPlayers.ContainsKey player.Id)

[<Fact>]
let ``removeStaleDisconnections removes a player disconnected before the cutoff`` () =
    let player = makePlayer "Alice"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)
    let room = { Room.create (RoomCode "1234") with Players = [ player ] }
    let room = Room.markDisconnected player.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, removedIds, _ = Room.removeStaleDisconnections cutoff room

    Assert.Equal<PlayerId list>([ player.Id ], removedIds)
    Assert.DoesNotContain(player, updated.Players)
    Assert.False(updated.DisconnectedPlayers.ContainsKey player.Id)

[<Fact>]
let ``removeStaleDisconnections keeps a player disconnected more recently than the cutoff`` () =
    let player = makePlayer "Alice"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-1.0)
    let room = { Room.create (RoomCode "1234") with Players = [ player ] }
    let room = Room.markDisconnected player.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, removedIds, _ = Room.removeStaleDisconnections cutoff room

    Assert.Empty(removedIds)
    Assert.Contains(player, updated.Players)

[<Fact>]
let ``removeStaleDisconnections leaves a still-connected player untouched`` () =
    let connected = makePlayer "Alice"
    let disconnected = makePlayer "Bob"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ connected; disconnected ] }

    let room = Room.markDisconnected disconnected.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, removedIds, _ = Room.removeStaleDisconnections cutoff room

    Assert.Equal<PlayerId list>([ disconnected.Id ], removedIds)
    Assert.Contains(connected, updated.Players)
    Assert.DoesNotContain(disconnected, updated.Players)

[<Fact>]
let ``removeStaleDisconnections drops play requests sent or received by a removed player`` () =
    let removedPlayer = makePlayer "Alice"
    let otherPlayer = makePlayer "Bob"
    let thirdPlayer = makePlayer "Carol"
    let disconnectedAt = DateTimeOffset.UtcNow.AddMinutes(-10.0)

    let requestFromRemoved: PlayRequest =
        { FromPlayerId = removedPlayer.Id
          FromPlayerName = removedPlayer.Name
          ToPlayerId = otherPlayer.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let requestToRemoved: PlayRequest =
        { FromPlayerId = thirdPlayer.Id
          FromPlayerName = thirdPlayer.Name
          ToPlayerId = removedPlayer.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let requestUnrelated: PlayRequest =
        { FromPlayerId = otherPlayer.Id
          FromPlayerName = otherPlayer.Name
          ToPlayerId = thirdPlayer.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ removedPlayer; otherPlayer; thirdPlayer ]
            PendingRequests = [ requestFromRemoved; requestToRemoved; requestUnrelated ] }

    let room = Room.markDisconnected removedPlayer.Id disconnectedAt room

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, _, _ = Room.removeStaleDisconnections cutoff room

    Assert.Equal<PlayRequest list>([ requestUnrelated ], updated.PendingRequests)

[<Fact>]
let ``removeStaleDisconnections is a no-op when nobody is disconnected`` () =
    let player = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ player ] }

    let cutoff = DateTimeOffset.UtcNow.AddMinutes(-5.0)
    let updated, removedIds, _ = Room.removeStaleDisconnections cutoff room

    Assert.Empty(removedIds)
    Assert.Equal<Player list>(room.Players, updated.Players)
