module BibleGuessr.Tests.MatchmakingTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayer name =
    { Id = PlayerId(Guid.NewGuid()); Name = name; Score = 0 }

// Built directly rather than through prepareJoin: these tests are about
// the queue, not about how a player gets into the room.
let private roomWith players =
    { Room.create (RoomCode "TEST") with Players = players }

let private entryFor (player: Player) seconds =
    { PlayerId = player.Id
      GameType = AllVerses
      RoundCount = 5
      RoundTimeLimit = Unlimited
      WaitingSince = DateTimeOffset(2026, 9, 5, 12, 0, seconds, TimeSpan.Zero) }

[<Fact>]
let ``a player who joins the queue is waiting`` () =
    let alice = makePlayer "Alice"
    let room = roomWith [ alice ] |> Room.joinMatchmaking (entryFor alice 0)

    Assert.True(Room.isWaitingForMatch alice.Id room)

[<Fact>]
let ``leaving the queue removes the player`` () =
    let alice = makePlayer "Alice"

    let room =
        roomWith [ alice ]
        |> Room.joinMatchmaking (entryFor alice 0)
        |> Room.leaveMatchmaking alice.Id

    Assert.False(Room.isWaitingForMatch alice.Id room)

// A player holds at most one place in the queue: re-requesting with new
// settings updates their entry rather than queueing them twice.
[<Fact>]
let ``joining twice replaces the earlier entry rather than duplicating it`` () =
    let alice = makePlayer "Alice"

    let room =
        roomWith [ alice ]
        |> Room.joinMatchmaking (entryFor alice 0)
        |> Room.joinMatchmaking { entryFor alice 5 with RoundCount = 9 }

    Assert.Equal(1, room.WaitingForMatch.Length)
    Assert.Equal(9, room.WaitingForMatch.Head.RoundCount)

[<Fact>]
let ``a waiting player is found as a match for someone else`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"
    let room = roomWith [ alice; bob ] |> Room.joinMatchmaking (entryFor alice 0)

    match Room.findMatchFor bob.Id room with
    | Some entry -> Assert.Equal(alice.Id, entry.PlayerId)
    | None -> failwith "expected Alice to be matched"

// Matching a player with themselves would start a game against nobody.
[<Fact>]
let ``a player is never matched with themselves`` () =
    let alice = makePlayer "Alice"
    let room = roomWith [ alice ] |> Room.joinMatchmaking (entryFor alice 0)

    Assert.True((Room.findMatchFor alice.Id room).IsNone)

// Whoever has waited longest goes first, rather than an arbitrary pick.
[<Fact>]
let ``the longest-waiting player is matched first`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"
    let carol = makePlayer "Carol"

    let room =
        roomWith [ alice; bob; carol ]
        |> Room.joinMatchmaking (entryFor alice 0)
        |> Room.joinMatchmaking (entryFor bob 5)

    match Room.findMatchFor carol.Id room with
    | Some entry -> Assert.Equal(alice.Id, entry.PlayerId)
    | None -> failwith "expected the longest-waiting player"

[<Fact>]
let ``an empty queue matches nobody`` () =
    let alice = makePlayer "Alice"

    Assert.True((Room.findMatchFor alice.Id (roomWith [ alice ])).IsNone)

// A queue entry does not outlive the player: someone who left the room
// cannot be matched, or the joiner would start a game against nobody.
[<Fact>]
let ``a player who left the room is not matched`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"

    let room =
        roomWith [ alice; bob ]
        |> Room.joinMatchmaking (entryFor alice 0)
        |> fun r -> { r with Players = r.Players |> List.filter (fun p -> p.Id <> alice.Id) }

    Assert.True((Room.findMatchFor bob.Id room).IsNone)

[<Fact>]
let ``a player already in a game cannot join the queue`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"

    let session =
        GameSession.start
            (GameId(Guid.NewGuid()))
            alice.Id
            bob.Id
            AllVerses
            5
            Unlimited
            { Book = "John"; BookNumber = 43; Chapter = 3; VerseNumber = 16 }
            DateTimeOffset.UtcNow

    let room =
        roomWith [ alice; bob ]
        |> Room.startGame session
        |> Room.joinMatchmaking (entryFor alice 0)

    Assert.False(Room.isWaitingForMatch alice.Id room)

[<Fact>]
let ``a waiting player who starts a game is no longer matchable`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"
    let carol = makePlayer "Carol"

    let session =
        GameSession.start
            (GameId(Guid.NewGuid()))
            alice.Id
            bob.Id
            AllVerses
            5
            Unlimited
            { Book = "John"; BookNumber = 43; Chapter = 3; VerseNumber = 16 }
            DateTimeOffset.UtcNow

    let room =
        roomWith [ alice; bob; carol ]
        |> Room.joinMatchmaking (entryFor alice 0)
        |> Room.startGame session

    Assert.True((Room.findMatchFor carol.Id room).IsNone)

// A queue entry must never outlive its player: leaving the room has to
// take the entry with it, or the next joiner is matched against nobody.
[<Fact>]
let ``leaving the room also leaves the queue`` () =
    let alice = makePlayer "Alice"
    let bob = makePlayer "Bob"

    let room, _ =
        roomWith [ alice; bob ]
        |> Room.joinMatchmaking (entryFor alice 0)
        |> Room.leave alice.Id

    Assert.False(Room.isWaitingForMatch alice.Id room)
    Assert.True((Room.findMatchFor bob.Id room).IsNone)
