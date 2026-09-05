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

// cancelPendingRequestsFor — see docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md:
// unlike removeStaleDisconnections, this fires the INSTANT a player disconnects (not after the
// grace period), and only ever touches PendingRequests — the player themself stays fully in
// Players/DisconnectedPlayers/ActiveGame, since they're still visible/mid-game, just offline.

[<Fact>]
let ``cancelPendingRequestsFor drops a request sent by the just-disconnected player`` () =
    let disconnecting = makePlayer "Alice"
    let other = makePlayer "Bob"

    let request: PlayRequest =
        { FromPlayerId = disconnecting.Id
          FromPlayerName = disconnecting.Name
          ToPlayerId = other.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ disconnecting; other ]
            PendingRequests = [ request ] }

    let updated, cancelled = Room.cancelPendingRequestsFor disconnecting.Id room

    Assert.Empty(updated.PendingRequests)
    Assert.Equal<PlayRequest list>([ request ], cancelled)

[<Fact>]
let ``cancelPendingRequestsFor drops a request received by the just-disconnected player`` () =
    let disconnecting = makePlayer "Alice"
    let other = makePlayer "Bob"

    let request: PlayRequest =
        { FromPlayerId = other.Id
          FromPlayerName = other.Name
          ToPlayerId = disconnecting.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ disconnecting; other ]
            PendingRequests = [ request ] }

    let updated, cancelled = Room.cancelPendingRequestsFor disconnecting.Id room

    Assert.Empty(updated.PendingRequests)
    Assert.Equal<PlayRequest list>([ request ], cancelled)

[<Fact>]
let ``cancelPendingRequestsFor leaves unrelated requests untouched and keeps the player in Players`` () =
    let disconnecting = makePlayer "Alice"
    let other = makePlayer "Bob"
    let third = makePlayer "Carol"

    let requestFromDisconnecting: PlayRequest =
        { FromPlayerId = disconnecting.Id
          FromPlayerName = disconnecting.Name
          ToPlayerId = other.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let requestToDisconnecting: PlayRequest =
        { FromPlayerId = third.Id
          FromPlayerName = third.Name
          ToPlayerId = disconnecting.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let requestUnrelated: PlayRequest =
        { FromPlayerId = other.Id
          FromPlayerName = other.Name
          ToPlayerId = third.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ disconnecting; other; third ]
            PendingRequests = [ requestFromDisconnecting; requestToDisconnecting; requestUnrelated ] }

    let updated, cancelled = Room.cancelPendingRequestsFor disconnecting.Id room

    Assert.Equal<PlayRequest list>([ requestUnrelated ], updated.PendingRequests)
    Assert.Equal(2, cancelled.Length)
    // The key behavioral difference from removeStaleDisconnections/removePlayers — the
    // disconnecting player is NOT removed here, only their pending requests are.
    Assert.Contains(disconnecting, updated.Players)

[<Fact>]
let ``cancelPendingRequestsFor does not touch ActiveGame`` () =
    let disconnecting = makePlayer "Alice"
    let opponent = makePlayer "Bob"
    let verse: VerseReference = { Book = "Genesis"; BookNumber = 1; Chapter = 1; VerseNumber = 1 }

    let request: PlayRequest =
        { FromPlayerId = disconnecting.Id
          FromPlayerName = disconnecting.Name
          ToPlayerId = opponent.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ disconnecting; opponent ] }

    let room = Room.sendPlayRequest request room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) disconnecting.Id opponent.Id verse DateTimeOffset.UtcNow room

    let updated, cancelled = Room.cancelPendingRequestsFor disconnecting.Id room

    Assert.Empty(cancelled)
    Assert.True(updated.ActiveGame.IsSome)

[<Fact>]
let ``cancelPendingRequestsFor is a no-op when the player has no pending requests`` () =
    let disconnecting = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ disconnecting ] }

    let updated, cancelled = Room.cancelPendingRequestsFor disconnecting.Id room

    Assert.Empty(cancelled)
    Assert.Equal<Room>(room, updated)

[<Fact>]
let ``cancelPendingRequestsFor drops multiple requests received from different senders`` () =
    let disconnecting = makePlayer "Alice"
    let senderA = makePlayer "Bob"
    let senderB = makePlayer "Carol"

    let requestA: PlayRequest =
        { FromPlayerId = senderA.Id
          FromPlayerName = senderA.Name
          ToPlayerId = disconnecting.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let requestB: PlayRequest =
        { FromPlayerId = senderB.Id
          FromPlayerName = senderB.Name
          ToPlayerId = disconnecting.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ disconnecting; senderA; senderB ]
            PendingRequests = [ requestA; requestB ] }

    let updated, cancelled = Room.cancelPendingRequestsFor disconnecting.Id room

    Assert.Empty(updated.PendingRequests)
    Assert.Equal(2, cancelled.Length)
    Assert.Contains(requestA, cancelled)
    Assert.Contains(requestB, cancelled)

[<Fact>]
let ``disconnectGracePeriod is two minutes`` () =
    Assert.Equal(TimeSpan.FromMinutes 2.0, Room.disconnectGracePeriod)
