module BibleGuessr.Tests.ScoringTests

open System
open Xunit
open BibleGuessr.Domain

// The shared kernel's building blocks with the standard tiers — what The
// Bible scores with (see scoring-scenarios/ and GameTypeScoringTests.fs
// for each game type's own rule). These guesses carry no BookNumber, so
// the book matches by name — see MultiplayerScoringByNumberTests.fs for
// matching by number.
let private verse: VerseReference = { Book = "John"; BookNumber = 43; Chapter = 3; VerseNumber = 16 }

let private standardPoints guess = Scoring.tieredPoints Scoring.standardTiers verse guess

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
    Assert.Equal(0, standardPoints guess)

[<Fact>]
let ``right book wrong chapter scores book points only`` () =
    let guess = makeGuess "John" (Some 4) (Some 16)
    Assert.Equal(10, standardPoints guess)

[<Fact>]
let ``right book with no chapter guessed scores book points only`` () =
    let guess = makeGuess "John" None None
    Assert.Equal(10, standardPoints guess)

[<Fact>]
let ``right book and chapter but wrong verse number scores book plus chapter points`` () =
    let guess = makeGuess "John" (Some 3) (Some 1)
    Assert.Equal(110, standardPoints guess)

[<Fact>]
let ``right book and chapter with no verse number guessed scores book plus chapter points`` () =
    let guess = makeGuess "John" (Some 3) None
    Assert.Equal(110, standardPoints guess)

[<Fact>]
let ``book chapter and verse number all correct scores the full total`` () =
    let guess = makeGuess "John" (Some 3) (Some 16)
    Assert.Equal(1110, standardPoints guess)

[<Fact>]
let ``book matching is case-insensitive`` () =
    let guess = makeGuess "jOHN" (Some 3) (Some 16)
    Assert.Equal(1110, standardPoints guess)

[<Fact>]
let ``book matching ignores surrounding whitespace`` () =
    let guess = makeGuess "  John " (Some 3) (Some 16)
    Assert.Equal(1110, standardPoints guess)

[<Fact>]
let ``each part only counts when every part before it is right`` () =
    let parts book chapter verseNumber = Scoring.correctParts verse (makeGuess book chapter verseNumber)

    Assert.Equal({ BookRight = true; ChapterRight = true; VerseNumberRight = true }, parts "John" (Some 3) (Some 16))
    Assert.Equal({ BookRight = true; ChapterRight = true; VerseNumberRight = false }, parts "John" (Some 3) (Some 17))
    Assert.Equal({ BookRight = true; ChapterRight = false; VerseNumberRight = false }, parts "John" (Some 4) (Some 16))
    // The right numbers in the wrong book count for nothing.
    Assert.Equal({ BookRight = false; ChapterRight = false; VerseNumberRight = false }, parts "Mark" (Some 3) (Some 16))

[<Fact>]
let ``a part that wasn't guessed isn't right`` () =
    Assert.Equal(
        { BookRight = true; ChapterRight = false; VerseNumberRight = false },
        Scoring.correctParts verse (makeGuess "John" None (Some 16))
    )

[<Fact>]
let ``a game type's own tiers decide what each right part is worth`` () =
    let noBook = { Scoring.standardTiers with BookPoints = 0 }
    Assert.Equal(1100, Scoring.tieredPoints noBook verse (makeGuess "John" (Some 3) (Some 16)))
    Assert.Equal(0, Scoring.tieredPoints noBook verse (makeGuess "John" None None))
