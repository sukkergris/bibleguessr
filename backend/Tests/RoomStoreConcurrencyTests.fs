module BibleGuessr.Tests.RoomStoreConcurrencyTests

// Reproduces a real bug report: two players submitting a guess for the
// same round at almost the same instant left one room permanently stuck
// with an ActiveGame that could never be joined/left again — "You can't
// send a play request while a game is in progress" with no game visibly
// running on either client.
//
// Root cause: every GameHub method (SubmitGuess included) does an
// unguarded `TryGet room -> compute newRoom -> Set(code, newRoom)`
// sequence. That whole sequence isn't atomic — RoomStore.Set/TryGet are
// each atomic individually (ConcurrentDictionary), but two concurrent
// callers can both TryGet the SAME starting snapshot, compute two
// DIFFERENT updates from it, and then Set one after the other — the
// second Set silently overwrites the first caller's update in its
// entirety, as if it never happened. A guess recorded by the first
// caller, or an ActiveGame cleared by the first caller, can be resurrected
// this way.
//
// The fix: RoomStore.Update(code, f) performs the whole
// read-compute-write as one atomic operation via
// ConcurrentDictionary.AddOrUpdate, which retries `f` under contention
// instead of assuming a single racing writer.

open System
open System.Threading.Tasks
open Xunit
open BibleGuessr.Domain
open BibleGuessr.Api.GameHub

let private makeRoom () =
    let store = RoomStore()
    let room = store.CreateRoom()
    let (RoomCode code) = room.Code
    store, code

[<Fact>]
let ``Update applies every concurrent increment exactly once`` () =
    let store, code = makeRoom ()

    // Each of these represents one hub call's "read room -> bump a
    // counter -> write room back" — modeled here as incrementing
    // Players.Length via a marker player, since Room has no raw counter
    // field. 200 concurrent updates is enough to reliably reproduce the
    // lost-update race on the old TryGet+Set pattern (confirmed failing
    // before the fix), while still running near-instantly.
    let concurrency = 200

    let addOnePlayer () =
        store.Update(
            code,
            fun room ->
                { room with
                    Players = { Id = PlayerId(Guid.NewGuid()); Name = "p"; Score = 0 } :: room.Players }
        )
        |> ignore

    System.Threading.Tasks.Parallel.For(0, concurrency, fun _ -> addOnePlayer ()) |> ignore

    match store.TryGet(code) with
    | Some room -> Assert.Equal(concurrency, room.Players.Length)
    | None -> failwith "expected the room to still exist"

[<Fact>]
let ``Update returns the room actually stored after applying f`` () =
    let store, code = makeRoom ()

    let result =
        store.Update(
            code,
            fun room ->
                { room with
                    Players = { Id = PlayerId(Guid.NewGuid()); Name = "Alice"; Score = 0 } :: room.Players }
        )

    match result with
    | Some updated -> Assert.Equal(1, updated.Players.Length)
    | None -> failwith "expected Some — the room exists"

[<Fact>]
let ``Update is a no-op returning None for a room code that doesn't exist`` () =
    let store = RoomStore()

    let result = store.Update("does-not-exist", fun room -> room)

    Assert.True(result.IsNone)

[<Fact>]
let ``concurrent guesses from both players are never lost (the reported bug)`` () =
    // The actual reported scenario, reproduced directly against
    // GameSession.submitGuess (the same pure function SubmitGuess calls)
    // going through RoomStore.Update from two "simultaneous" callers,
    // instead of the old TryGet+compute+Set: both guesses must land, not
    // just whichever caller's Set happened to run last.
    let store, code = makeRoom ()
    let playerA = PlayerId(Guid.NewGuid())
    let playerB = PlayerId(Guid.NewGuid())
    let verse: VerseReference = { Book = "John"; BookNumber = 43; Chapter = 3; VerseNumber = 16 }

    let session = GameSession.start playerA playerB AllVerses 5 Unlimited verse DateTimeOffset.UtcNow

    store.Update(code, fun room -> Room.startGame session room) |> ignore

    let guessFor playerId : Guess =
        { PlayerId = playerId
          Book = "John"
          BookNumber = Some 43
          Chapter = Some 3
          VerseNumber = Some 16
          SubmittedAt = DateTimeOffset.UtcNow }

    let submit playerId () =
        store.Update(code, Room.updateGame (GameSession.submitGuess playerId (guessFor playerId))) |> ignore

    System.Threading.Tasks.Parallel.Invoke(Action(submit playerA), Action(submit playerB))

    match store.TryGet(code) with
    | Some { ActiveGame = Some updatedSession } -> Assert.True(GameSession.bothGuessed updatedSession)
    | _ -> failwith "expected an ActiveGame with both guesses recorded"
