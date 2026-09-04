module BibleGuessr.Tests.ScoringTests

open System
open Xunit
open BibleGuessr.Domain

// pointsForVerseGuess (the singleplayer scorer these tests cover) matches
// by book NAME only — see MultiplayerScoringByNumberTests.fs for the
// number-based isCorrectGuess these BookNumber values are irrelevant to.
let private verse: VerseReference = { Book = "John"; BookNumber = 43; Chapter = 3; VerseNumber = 16 }

let private makeGuess book chapter verseNumber : Guess =
    { PlayerId = PlayerId(Guid.NewGuid())
      Book = book
      BookNumber = None
      Chapter = chapter
      VerseNumber = verseNumber
      SubmittedAt = DateTimeOffset.UtcNow }

[<Fact>]
let ``wrong book scores 0`` () =
    let guess = makeGuess "Genesis" (Some 3) (Some 16)
    Assert.Equal(0, Scoring.pointsForVerseGuess verse guess)

[<Fact>]
let ``right book wrong chapter scores book points only`` () =
    let guess = makeGuess "John" (Some 4) (Some 16)
    Assert.Equal(10, Scoring.pointsForVerseGuess verse guess)

[<Fact>]
let ``right book with no chapter guessed scores book points only`` () =
    let guess = makeGuess "John" None None
    Assert.Equal(10, Scoring.pointsForVerseGuess verse guess)

[<Fact>]
let ``right book and chapter but wrong verse number scores book plus chapter points`` () =
    let guess = makeGuess "John" (Some 3) (Some 1)
    Assert.Equal(110, Scoring.pointsForVerseGuess verse guess)

[<Fact>]
let ``right book and chapter with no verse number guessed scores book plus chapter points`` () =
    let guess = makeGuess "John" (Some 3) None
    Assert.Equal(110, Scoring.pointsForVerseGuess verse guess)

[<Fact>]
let ``book chapter and verse number all correct scores the full total`` () =
    let guess = makeGuess "John" (Some 3) (Some 16)
    Assert.Equal(1110, Scoring.pointsForVerseGuess verse guess)

[<Fact>]
let ``book matching is case-insensitive`` () =
    let guess = makeGuess "jOHN" (Some 3) (Some 16)
    Assert.Equal(1110, Scoring.pointsForVerseGuess verse guess)
