module BibleGuessr.Tests.PlayRequestTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayerId () = PlayerId(Guid.NewGuid())

[<Fact>]
let ``a retargeted request carries the sender's name forward correctly`` () =
    let sender = makePlayerId ()
    let firstTarget = makePlayerId ()
    let secondTarget = makePlayerId ()

    let firstRequest: PlayRequest =
        { FromPlayerId = sender
          FromPlayerName = "Alice"
          ToPlayerId = firstTarget
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let secondRequest: PlayRequest =
        { FromPlayerId = sender
          FromPlayerName = "Alice"
          ToPlayerId = secondTarget
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow.AddSeconds(1.0) }

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest firstRequest room
    let room = Room.sendPlayRequest secondRequest room

    Assert.Equal(1, room.PendingRequests.Length)
    let survivingRequest = room.PendingRequests.Head
    Assert.Equal("Alice", survivingRequest.FromPlayerName)
    Assert.Equal(secondTarget, survivingRequest.ToPlayerId)

[<Fact>]
let ``two different players can each have one pending request to the same target`` () =
    let target = makePlayerId ()
    let senderA = makePlayerId ()
    let senderB = makePlayerId ()

    let requestFrom sender : PlayRequest =
        { FromPlayerId = sender
          FromPlayerName = "someone"
          ToPlayerId = target
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (requestFrom senderA) room
    let room = Room.sendPlayRequest (requestFrom senderB) room

    let requestsForTarget = Room.pendingRequestsFor target room
    Assert.Equal(2, requestsForTarget.Length)

[<Fact>]
let ``withdrawing one sender's request does not affect another sender's request to the same target`` () =
    let target = makePlayerId ()
    let senderA = makePlayerId ()
    let senderB = makePlayerId ()

    let requestFrom sender : PlayRequest =
        { FromPlayerId = sender
          FromPlayerName = "someone"
          ToPlayerId = target
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (requestFrom senderA) room
    let room = Room.sendPlayRequest (requestFrom senderB) room
    let room = Room.withdrawPlayRequest senderA room

    let requestsForTarget = Room.pendingRequestsFor target room
    Assert.Equal(1, requestsForTarget.Length)
    Assert.Equal(senderB, requestsForTarget.Head.FromPlayerId)
