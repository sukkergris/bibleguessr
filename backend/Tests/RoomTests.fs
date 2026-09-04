module BibleGuessr.Tests.RoomTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayerId () = PlayerId(Guid.NewGuid())

let private makeMessage playerId text : ChatMessage =
    { PlayerId = playerId
      PlayerName = "someone"
      Text = text
      SentAt = DateTimeOffset.UtcNow }

let private makeRequest fromId toId : PlayRequest =
    { FromPlayerId = fromId
      FromPlayerName = "someone"
      ToPlayerId = toId
      GameType = AllVerses
      SentAt = DateTimeOffset.UtcNow }

[<Fact>]
let ``addMessage truncates to maxRecentMessages`` () =
    let playerId = makePlayerId ()

    let room =
        [ 1 .. Room.maxRecentMessages + 5 ]
        |> List.fold (fun room i -> Room.addMessage (makeMessage playerId (string i)) room) (Room.create (RoomCode "1234"))

    Assert.Equal(Room.maxRecentMessages, room.RecentMessages.Length)

[<Fact>]
let ``addMessage keeps the most recent messages first`` () =
    let playerId = makePlayerId ()
    let room = Room.create (RoomCode "1234")
    let room = Room.addMessage (makeMessage playerId "first") room
    let room = Room.addMessage (makeMessage playerId "second") room

    Assert.Equal("second", room.RecentMessages.Head.Text)

[<Fact>]
let ``sendPlayRequest replaces an existing request from the same sender`` () =
    let sender = makePlayerId ()
    let firstTarget = makePlayerId ()
    let secondTarget = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest sender firstTarget) room
    let room = Room.sendPlayRequest (makeRequest sender secondTarget) room

    Assert.Equal(1, room.PendingRequests.Length)
    Assert.Equal(secondTarget, room.PendingRequests.Head.ToPlayerId)

[<Fact>]
let ``sendPlayRequest keeps requests from different senders`` () =
    let senderA = makePlayerId ()
    let senderB = makePlayerId ()
    let target = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest senderA target) room
    let room = Room.sendPlayRequest (makeRequest senderB target) room

    Assert.Equal(2, room.PendingRequests.Length)

[<Fact>]
let ``withdrawPlayRequest removes only the matching sender's request`` () =
    let senderA = makePlayerId ()
    let senderB = makePlayerId ()
    let target = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest senderA target) room
    let room = Room.sendPlayRequest (makeRequest senderB target) room
    let room = Room.withdrawPlayRequest senderA room

    Assert.Equal(1, room.PendingRequests.Length)
    Assert.Equal(senderB, room.PendingRequests.Head.FromPlayerId)

[<Fact>]
let ``withdrawPlayRequest is a no-op when the sender has no pending request`` () =
    let sender = makePlayerId ()
    let room = Room.create (RoomCode "1234")

    let room = Room.withdrawPlayRequest sender room

    Assert.Empty(room.PendingRequests)

[<Fact>]
let ``pendingRequestsFor filters by ToPlayerId`` () =
    let senderA = makePlayerId ()
    let senderB = makePlayerId ()
    let targetA = makePlayerId ()
    let targetB = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest senderA targetA) room
    let room = Room.sendPlayRequest (makeRequest senderB targetB) room

    let requestsForA = Room.pendingRequestsFor targetA room

    Assert.Equal(1, requestsForA.Length)
    Assert.Equal(senderA, requestsForA.Head.FromPlayerId)

[<Fact>]
let ``acceptPlayRequest removes the matching request`` () =
    let sender = makePlayerId ()
    let target = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest sender target) room
    let room = Room.acceptPlayRequest sender target room

    Assert.Empty(room.PendingRequests)

[<Fact>]
let ``acceptPlayRequest leaves other players' requests to the same target untouched`` () =
    let senderA = makePlayerId ()
    let senderB = makePlayerId ()
    let target = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest senderA target) room
    let room = Room.sendPlayRequest (makeRequest senderB target) room
    let room = Room.acceptPlayRequest senderA target room

    Assert.Equal(1, room.PendingRequests.Length)
    Assert.Equal(senderB, room.PendingRequests.Head.FromPlayerId)

[<Fact>]
let ``denyPlayRequest removes the matching request`` () =
    let sender = makePlayerId ()
    let target = makePlayerId ()

    let room = Room.create (RoomCode "1234")
    let room = Room.sendPlayRequest (makeRequest sender target) room
    let room = Room.denyPlayRequest sender target room

    Assert.Empty(room.PendingRequests)

[<Fact>]
let ``acceptPlayRequest is a no-op when the request no longer exists`` () =
    let sender = makePlayerId ()
    let target = makePlayerId ()
    let room = Room.create (RoomCode "1234")

    let room = Room.acceptPlayRequest sender target room

    Assert.Empty(room.PendingRequests)
