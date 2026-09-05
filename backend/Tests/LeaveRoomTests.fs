module BibleGuessr.Tests.LeaveRoomTests

// Covers Room.leave — a player VOLUNTARILY leaving the room (clicking
// "← Home" or "Back to chat selection"), as opposed to their connection
// merely dropping (Room.markDisconnected/removeStaleDisconnections).
//
// Motivating bug: before this existed, there was no hub method that told
// the server "I'm leaving" — going Home only tore down local UI state
// (see bg-app.ts's _onGoHome and bg-room-setup.ts's _onLeaveRoom, both of
// which never touched the server). The underlying SignalR connection is a
// page-lifetime singleton (see signalr-client.ts) that's never stopped on
// navigation, so the old Player stayed fully "connected" server-side for
// as long as the tab stayed open — making Room.prepareJoin correctly (but
// unhelpfully) reject any attempt to come back into World chat under the
// same name, since as far as the server knew, that name was still live
// and in use. Room.leave removes the player immediately, unconditionally
// (no grace period — this is a deliberate, in-the-moment departure, not a
// dropped connection that might recover), so a subsequent rejoin under
// the same name succeeds right away instead of being told the name is
// taken.

open System
open Xunit
open BibleGuessr.Domain

let private makePlayer name : Player =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

[<Fact>]
let ``leave removes the player from Players`` () =
    let alice = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ alice ] }

    let updated, _ = Room.leave alice.Id room

    Assert.DoesNotContain(alice, updated.Players)

[<Fact>]
let ``leave is a no-op for a player who isn't in the room`` () =
    let stranger = PlayerId(Guid.NewGuid())
    let room = Room.create (RoomCode "1234")

    let updated, forfeitedOpponent = Room.leave stranger room

    Assert.Equal<Player list>([], updated.Players)
    Assert.True(forfeitedOpponent.IsNone)

[<Fact>]
let ``leave immediately frees up the leaver's name for someone else to join under`` () =
    let alice = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ alice ] }

    let afterLeaving, _ = Room.leave alice.Id room

    match Room.prepareJoin "Alice" afterLeaving with
    | Ok _ -> ()
    | Error () -> failwith "expected Ok — the name should be free the instant the player leaves, no grace period"

[<Fact>]
let ``leave drops the leaver's disconnection bookkeeping too, if any`` () =
    // A player can leave voluntarily while ALSO still marked disconnected
    // from an earlier drop (e.g. a flaky connection recovered just long
    // enough for them to click Home) — leave should clean that up too,
    // not just Players.
    let alice = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ alice ] }
    let room = Room.markDisconnected alice.Id DateTimeOffset.UtcNow room

    let updated, _ = Room.leave alice.Id room

    Assert.False(updated.DisconnectedPlayers.ContainsKey alice.Id)

[<Fact>]
let ``leave drops the leaver's pending play requests`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"

    let request: PlayRequest =
        { FromPlayerId = alice.Id
          FromPlayerName = alice.Name
          ToPlayerId = bob.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ alice; bob ]
            PendingRequests = [ request ] }

    let updated, _ = Room.leave alice.Id room

    Assert.Empty(updated.PendingRequests)

[<Fact>]
let ``leave leaves other players and their unrelated requests untouched`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"
    let carol = makePlayer "Carol"

    let unrelatedRequest: PlayRequest =
        { FromPlayerId = bob.Id
          FromPlayerName = bob.Name
          ToPlayerId = carol.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ alice; bob; carol ]
            PendingRequests = [ unrelatedRequest ] }

    let updated, _ = Room.leave alice.Id room

    Assert.Contains(bob, updated.Players)
    Assert.Contains(carol, updated.Players)
    Assert.Contains(unrelatedRequest, updated.PendingRequests)

[<Fact>]
let ``leave ends the leaver's active game, freeing their opponent`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"
    let verse: VerseReference = { Book = "Genesis"; BookNumber = 1; Chapter = 1; VerseNumber = 1 }

    let request: PlayRequest =
        { FromPlayerId = alice.Id
          FromPlayerName = alice.Name
          ToPlayerId = bob.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room = { Room.create (RoomCode "1234") with Players = [ alice; bob ] }
    let room = Room.sendPlayRequest request room
    let room, _ = Room.acceptPlayRequest (GameId(Guid.NewGuid())) alice.Id bob.Id verse DateTimeOffset.UtcNow room

    let updated, forfeitedOpponent = Room.leave alice.Id room

    Assert.True(updated.ActiveGame.IsNone)
    Assert.Equal(Some bob.Id, forfeitedOpponent)

[<Fact>]
let ``leave returns no forfeited opponent when the leaver had no active game`` () =
    let alice = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ alice ] }

    let _, forfeitedOpponent = Room.leave alice.Id room

    Assert.True(forfeitedOpponent.IsNone)
