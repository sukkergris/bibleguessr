module BibleGuessr.Tests.GameTypeScoringTests

// Each game type owns its multiplayer scoring rule (see
// Domain/GameTypes/<Name>.fs's scoreGuess and docs/web/game-types).
// The Bible and Books use Scoring.standardMultiplayer; Chapters has its
// own rule, since its book is a given. These tests pin each type's rule
// down, so changing one is a deliberate, visible change here — and the
// other types' tests prove they are unaffected.

open System
open Xunit
open BibleGuessr.Domain

let private verse: VerseReference =
    { Book = "Rut"
      BookNumber = 8
      Chapter = 1
      VerseNumber = 16 }

let private guessOf bookNumber chapter : Guess =
    { PlayerId = PlayerId(Guid.NewGuid())
      Book = "Rut"
      BookNumber = Some bookNumber
      Chapter = chapter
      VerseNumber = None
      SubmittedAt = DateTimeOffset.UtcNow }

let private roundLength = TimeSpan.FromSeconds 60.0
let private halfway = TimeSpan.FromSeconds 30.0

/// The game types that use the standard rule.
let standardGameTypes: obj array seq = [ [| box AllVerses |]; [| box (Books [ 8 ]) |] ]

let private chapters = Chapters(Map.ofList [ 8, [ 1; 2 ] ])

/// A Chapters game with a single chapter picked: the chapter is a given too.
let private oneChapter = Chapters(Map.ofList [ 8, [ 1 ] ])

let private guessWithVerse bookNumber chapter verseNumber =
    { guessOf bookNumber (Some chapter) with VerseNumber = Some verseNumber }

[<Theory>]
[<MemberData(nameof standardGameTypes)>]
let ``a correct guess in an untimed round earns the flat points`` (gameType: GameType) =
    let score = GameType.scoreGuess gameType Unlimited halfway verse (guessOf 8 (Some 1))
    Assert.Equal({ Correct = true; Points = Scoring.unlimitedCorrectPoints }, score)

[<Theory>]
[<MemberData(nameof standardGameTypes)>]
let ``a correct guess in a timed round earns points that decay with time`` (gameType: GameType) =
    let score = GameType.scoreGuess gameType (LimitedTo roundLength) halfway verse (guessOf 8 None)
    Assert.Equal({ Correct = true; Points = Scoring.pointsForGuess roundLength halfway true }, score)

[<Theory>]
[<MemberData(nameof standardGameTypes)>]
let ``a wrong guess earns nothing`` (gameType: GameType) =
    let score = GameType.scoreGuess gameType (LimitedTo roundLength) halfway verse (guessOf 9 None)
    Assert.Equal({ Correct = false; Points = 0 }, score)

[<Fact>]
let ``Chapters: the right chapter is correct and earns the points`` () =
    Assert.Equal(
        { Correct = true; Points = Scoring.unlimitedCorrectPoints },
        GameType.scoreGuess chapters Unlimited halfway verse (guessOf 8 (Some 1))
    )

    Assert.Equal(
        { Correct = true; Points = Scoring.pointsForGuess roundLength halfway true },
        GameType.scoreGuess chapters (LimitedTo roundLength) halfway verse (guessOf 8 (Some 1))
    )

// In the standard rule a book-only guess counts as correct. In Chapters
// the book is fixed at setup, so that would be points for nothing.
[<Fact>]
let ``Chapters: the given book alone earns nothing`` () =
    Assert.Equal({ Correct = false; Points = 0 }, GameType.scoreGuess chapters Unlimited halfway verse (guessOf 8 None))

    Assert.Equal(
        { Correct = false; Points = 0 },
        GameType.scoreGuess chapters (LimitedTo roundLength) halfway verse (guessOf 8 None)
    )

[<Fact>]
let ``Chapters: the wrong chapter earns nothing`` () =
    Assert.Equal({ Correct = false; Points = 0 }, GameType.scoreGuess chapters Unlimited halfway verse (guessOf 8 (Some 2)))

// With one chapter picked, the chapter is as much a given as the book, so
// only the verse number is left to get right.
[<Fact>]
let ``Chapters with one chapter: the given chapter alone earns nothing`` () =
    Assert.Equal({ Correct = false; Points = 0 }, GameType.scoreGuess oneChapter Unlimited halfway verse (guessOf 8 (Some 1)))

[<Fact>]
let ``Chapters with one chapter: the wrong verse earns nothing`` () =
    Assert.Equal({ Correct = false; Points = 0 }, GameType.scoreGuess oneChapter Unlimited halfway verse (guessWithVerse 8 1 15))

[<Fact>]
let ``Chapters with one chapter: the right verse is correct and earns the points`` () =
    Assert.Equal(
        { Correct = true; Points = Scoring.pointsForGuess roundLength halfway true },
        GameType.scoreGuess oneChapter (LimitedTo roundLength) halfway verse (guessWithVerse 8 1 16)
    )
