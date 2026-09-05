module BibleGuessr.Tests.GameSessionTests

open System
open Xunit
open BibleGuessr.Domain

let private makePlayerId () = PlayerId(Guid.NewGuid())

let private makeVerse book chapter verseNumber : VerseReference =
    { Book = book; BookNumber = 0; Chapter = chapter; VerseNumber = verseNumber }

// BookNumber = None — these tests exercise scoreRound/GameSession
// mechanics generically, not the number-vs-name matching fix itself (see
// MultiplayerScoringByNumberTests.fs for that), so they rely on
// isCorrectGuess's name-matching fallback, same as before BookNumber
// existed.
let private makeGuess playerId book chapter verseNumber : Guess =
    { PlayerId = playerId
      Book = book
      BookNumber = None
      Chapter = chapter
      VerseNumber = verseNumber
      SubmittedAt = DateTimeOffset.UtcNow }

let private startedAt = DateTimeOffset.UtcNow

let private startSession playerA playerB roundCount timeLimit verse =
    GameSession.start (GameId(Guid.NewGuid())) playerA playerB AllVerses roundCount timeLimit verse startedAt

[<Fact>]
let ``start seeds both players' scores at zero`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)

    Assert.Equal(0, session.Scores[playerA])
    Assert.Equal(0, session.Scores[playerB])

[<Fact>]
let ``start puts the first round InProgress with the given verse`` () =
    let verse = makeVerse "John" 3 16
    let session = startSession (makePlayerId ()) (makePlayerId ()) 5 Unlimited verse

    Assert.Equal(InProgress verse, session.Round)

[<Fact>]
let ``start begins at round index zero`` () =
    let session = startSession (makePlayerId ()) (makePlayerId ()) 5 Unlimited (makeVerse "John" 3 16)

    Assert.Equal(0, session.RoundIndex)

[<Fact>]
let ``submitGuess records a guess from PlayerA`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)

    let updated = GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16)) session

    Assert.True(updated.GuessesThisRound.ContainsKey playerA)

[<Fact>]
let ``submitGuess from an unrelated player is a no-op`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let stranger = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)

    let updated = GameSession.submitGuess stranger (makeGuess stranger "John" (Some 3) (Some 16)) session

    Assert.Empty(updated.GuessesThisRound)

[<Fact>]
let ``submitGuess overwrites a player's earlier guess this round`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)

    let updated =
        session
        |> GameSession.submitGuess playerA (makeGuess playerA "Genesis" None None)
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))

    Assert.Equal("John", updated.GuessesThisRound[playerA].Book)

[<Fact>]
let ``bothGuessed is false until both players have submitted`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)

    let updated = GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16)) session

    Assert.False(GameSession.bothGuessed updated)

[<Fact>]
let ``bothGuessed is true once both players have submitted`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)

    let updated =
        session
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))
        |> GameSession.submitGuess playerB (makeGuess playerB "Genesis" None None)

    Assert.True(GameSession.bothGuessed updated)

[<Fact>]
let ``submitGuess after the round is already Scored is a no-op`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16)
    let scored = GameSession.scoreRound (startedAt.AddSeconds 1.0) session

    let updated = GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16)) scored

    Assert.Empty(updated.GuessesThisRound)

[<Fact>]
let ``scoreRound with LimitedTo awards decaying points via Scoring.pointsForGuess`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16

    let session =
        GameSession.start (GameId(Guid.NewGuid())) playerA playerB AllVerses 5 (LimitedTo(TimeSpan.FromSeconds 60.0)) verse startedAt
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))

    let scored = GameSession.scoreRound (startedAt.AddSeconds 30.0) session

    match scored.Round with
    | Scored(_, results) ->
        let result = results |> List.find (fun r -> r.PlayerId = playerA)
        let expected = Scoring.pointsForGuess (TimeSpan.FromSeconds 60.0) (TimeSpan.FromSeconds 30.0) true
        Assert.Equal(expected, result.PointsAwarded)
    | _ -> failwith "expected Scored"

[<Fact>]
let ``scoreRound with Unlimited awards full points for a correct guess`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16

    let session =
        startSession playerA playerB 5 Unlimited verse
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))

    let scored = GameSession.scoreRound (startedAt.AddSeconds 5.0) session

    match scored.Round with
    | Scored(_, results) ->
        let result = results |> List.find (fun r -> r.PlayerId = playerA)
        Assert.Equal(100, result.PointsAwarded)
    | _ -> failwith "expected Scored"

[<Fact>]
let ``scoreRound omits a GuessResult for a player who never guessed`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16

    let session =
        startSession playerA playerB 5 Unlimited verse
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))

    let scored = GameSession.scoreRound (startedAt.AddSeconds 1.0) session

    match scored.Round with
    | Scored(_, results) -> Assert.Equal(1, results.Length)
    | _ -> failwith "expected Scored"

[<Fact>]
let ``scoreRound adds points into the running Scores total, not replacing it`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16

    let session =
        { startSession playerA playerB 5 Unlimited verse with Scores = Map.ofList [ playerA, 50; playerB, 0 ] }
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))

    let scored = GameSession.scoreRound (startedAt.AddSeconds 1.0) session

    Assert.Equal(150, scored.Scores[playerA])

[<Fact>]
let ``scoreRound moves Round from InProgress to Scored`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16
    let session = startSession playerA playerB 5 Unlimited verse

    let scored = GameSession.scoreRound (startedAt.AddSeconds 1.0) session

    match scored.Round with
    | Scored(scoredVerse, _) -> Assert.Equal(verse, scoredVerse)
    | _ -> failwith "expected Scored"

[<Fact>]
let ``advanceRound increments RoundIndex and resets GuessesThisRound`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16

    let session =
        startSession playerA playerB 5 Unlimited verse
        |> GameSession.submitGuess playerA (makeGuess playerA "John" (Some 3) (Some 16))
        |> GameSession.scoreRound (startedAt.AddSeconds 1.0)

    let advanced = GameSession.advanceRound (makeVerse "Genesis" 1 1) (startedAt.AddSeconds 2.0) session

    Assert.Equal(1, advanced.RoundIndex)
    Assert.Empty(advanced.GuessesThisRound)

[<Fact>]
let ``advanceRound moves Round to InProgress with the new verse`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let session = startSession playerA playerB 5 Unlimited (makeVerse "John" 3 16) |> GameSession.scoreRound (startedAt.AddSeconds 1.0)
    let nextVerse = makeVerse "Genesis" 1 1

    let advanced = GameSession.advanceRound nextVerse (startedAt.AddSeconds 2.0) session

    Assert.Equal(InProgress nextVerse, advanced.Round)

[<Fact>]
let ``isOver is false before the final round`` () =
    let session = startSession (makePlayerId ()) (makePlayerId ()) 3 Unlimited (makeVerse "John" 3 16)
    let atRoundOne = { session with RoundIndex = 1 }

    Assert.False(GameSession.isOver atRoundOne)

[<Fact>]
let ``isOver is true at the final round index`` () =
    let session = startSession (makePlayerId ()) (makePlayerId ()) 3 Unlimited (makeVerse "John" 3 16)
    let atFinalRound = { session with RoundIndex = 2 }

    Assert.True(GameSession.isOver atFinalRound)

[<Fact>]
let ``isRoundExpired is false for Unlimited regardless of elapsed time`` () =
    let session = startSession (makePlayerId ()) (makePlayerId ()) 5 Unlimited (makeVerse "John" 3 16)

    Assert.False(GameSession.isRoundExpired (startedAt.AddDays 1.0) session)

[<Fact>]
let ``isRoundExpired is true once elapsed time reaches the LimitedTo duration`` () =
    let session =
        GameSession.start (GameId(Guid.NewGuid())) (makePlayerId ()) (makePlayerId ()) AllVerses 5 (LimitedTo(TimeSpan.FromSeconds 30.0)) (makeVerse "John" 3 16) startedAt

    Assert.True(GameSession.isRoundExpired (startedAt.AddSeconds 30.0) session)

[<Fact>]
let ``isRoundExpired is false before the duration has elapsed`` () =
    let session =
        GameSession.start (GameId(Guid.NewGuid())) (makePlayerId ()) (makePlayerId ()) AllVerses 5 (LimitedTo(TimeSpan.FromSeconds 30.0)) (makeVerse "John" 3 16) startedAt

    Assert.False(GameSession.isRoundExpired (startedAt.AddSeconds 10.0) session)

[<Fact>]
let ``isRoundExpired is false when the round is already Scored`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()

    let session =
        GameSession.start (GameId(Guid.NewGuid())) playerA playerB AllVerses 5 (LimitedTo(TimeSpan.FromSeconds 30.0)) (makeVerse "John" 3 16) startedAt
        |> GameSession.scoreRound (startedAt.AddSeconds 30.0)

    Assert.False(GameSession.isRoundExpired (startedAt.AddSeconds 60.0) session)

// A game must be identifiable in its own right, not just by the pair of
// players in it. Without this, a GameOver from a finished game still
// "matches" the same two players if they immediately start another one,
// and tears the new game down mid-round — see
// docs/SCRUM/BUGS/BUG.StaleGameOverEndsTheWrongGame.md.
[<Fact>]
let ``two games between the same players have different ids`` () =
    let playerA = makePlayerId ()
    let playerB = makePlayerId ()
    let verse = makeVerse "John" 3 16

    let first = startSession playerA playerB 5 Unlimited verse
    let second = startSession playerA playerB 5 Unlimited verse

    Assert.NotEqual(first.GameId, second.GameId)
