module BibleGuessr.Tests.UniquePlayerNameTests

// Covers Room.prepareJoin — see docs/SCRUM/Featue.UniquePlayerName.md:
// each player must have a unique name within a room, joining with a name
// already in use must be rejected with a clear reason, and reconnecting
// (dropping then rejoining under the same name before the stale-player
// sweep removes the old entry) must NOT be treated as a duplicate.
//
// Name matching is case-SENSITIVE ("Alice" and "alice" can coexist) —
// deliberately different from this codebase's usual OrdinalIgnoreCase
// book-name matching, per an explicit product decision for this feature.

open System
open Xunit
open BibleGuessr.Domain

let private makePlayer name : Player =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

[<Fact>]
let ``prepareJoin succeeds when the name isn't taken`` () =
    let room = Room.create (RoomCode "1234")

    match Room.prepareJoin "Alice" room with
    | Ok updated -> Assert.Equal<Player list>([], updated.Players)
    | Error () -> failwith "expected Ok"

[<Fact>]
let ``prepareJoin rejects a name already held by a connected player`` () =
    let existing = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ existing ] }

    match Room.prepareJoin "Alice" room with
    | Error () -> ()
    | Ok _ -> failwith "expected Error"

[<Fact>]
let ``prepareJoin is case-sensitive`` () =
    let existing = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ existing ] }

    match Room.prepareJoin "alice" room with
    | Ok _ -> ()
    | Error () -> failwith "expected Ok — different case is a different name"

[<Fact>]
let ``prepareJoin allows a different name to join alongside an existing player`` () =
    let existing = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ existing ] }

    match Room.prepareJoin "Bob" room with
    | Ok updated -> Assert.Contains(existing, updated.Players)
    | Error () -> failwith "expected Ok"

[<Fact>]
let ``prepareJoin succeeds and removes a DISCONNECTED player of the same name`` () =
    let stale = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ stale ] }
    let room = Room.markDisconnected stale.Id DateTimeOffset.UtcNow room

    match Room.prepareJoin "Alice" room with
    | Ok updated -> Assert.DoesNotContain(stale, updated.Players)
    | Error () -> failwith "expected Ok — a disconnected player's own name should free up for their reconnect"

[<Fact>]
let ``prepareJoin also drops the stale player's disconnection bookkeeping`` () =
    let stale = makePlayer "Alice"
    let room = { Room.create (RoomCode "1234") with Players = [ stale ] }
    let room = Room.markDisconnected stale.Id DateTimeOffset.UtcNow room

    match Room.prepareJoin "Alice" room with
    | Ok updated -> Assert.False(updated.DisconnectedPlayers.ContainsKey stale.Id)
    | Error () -> failwith "expected Ok"

[<Fact>]
let ``prepareJoin drops the stale player's pending play requests`` () =
    let stale = makePlayer "Alice"
    let other = makePlayer "Carol"

    let request: PlayRequest =
        { FromPlayerId = stale.Id
          FromPlayerName = stale.Name
          ToPlayerId = other.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ stale; other ]
            PendingRequests = [ request ] }

    let room = Room.markDisconnected stale.Id DateTimeOffset.UtcNow room

    match Room.prepareJoin "Alice" room with
    | Ok updated -> Assert.Empty(updated.PendingRequests)
    | Error () -> failwith "expected Ok"

[<Fact>]
let ``prepareJoin leaves other connected players and their requests untouched when replacing a stale one`` () =
    let stale = makePlayer "Alice"
    let other = makePlayer "Bob"

    let unrelatedRequest: PlayRequest =
        { FromPlayerId = other.Id
          FromPlayerName = other.Name
          ToPlayerId = stale.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ stale; other ]
            PendingRequests = [ unrelatedRequest ] }

    let room = Room.markDisconnected stale.Id DateTimeOffset.UtcNow room

    match Room.prepareJoin "Alice" room with
    | Ok updated ->
        Assert.Contains(other, updated.Players)
        // The request named the stale player too, so it's gone — but Bob
        // himself, and Bob's own place in the room, are untouched.
        Assert.DoesNotContain(other.Id, updated.PendingRequests |> List.map (fun r -> r.FromPlayerId))
    | Error () -> failwith "expected Ok"

[<Fact>]
let ``prepareJoin ends the stale player's active game, freeing their opponent`` () =
    let stale = makePlayer "Alice"
    let opponent = makePlayer "Bob"
    let verse: VerseReference = { Book = "Genesis"; BookNumber = 1; Chapter = 1; VerseNumber = 1 }

    let request: PlayRequest =
        { FromPlayerId = stale.Id
          FromPlayerName = stale.Name
          ToPlayerId = opponent.Id
          GameType = AllVerses
          RoundCount = 5
          RoundTimeLimit = Unlimited
          SentAt = DateTimeOffset.UtcNow }

    let room =
        { Room.create (RoomCode "1234") with
            Players = [ stale; opponent ] }

    let room = Room.sendPlayRequest request room
    let room, _ = Room.acceptPlayRequest stale.Id opponent.Id verse DateTimeOffset.UtcNow room
    let room = Room.markDisconnected stale.Id DateTimeOffset.UtcNow room

    match Room.prepareJoin "Alice" room with
    | Ok updated -> Assert.True(updated.ActiveGame.IsNone)
    | Error () -> failwith "expected Ok"
