module BibleGuessr.Tests.MultiplayerScoringByNumberTests

// Scoring.isCorrectGuess (the scorer multiplayer rounds actually use — see
// GameSession.scoreRound) must compare guesses by BOOK NUMBER, not name —
// this is the direct fix for the reported bug: a player's own uploaded
// file may spell a book differently than whatever spelling the round's
// VerseReference happens to carry (itself derived from the server's own
// pool, per BookNumberTests.fs), so matching by name silently fails a
// genuinely correct guess. Guess.BookNumber is set client-side (see
// frontend/src/game-type.ts) by resolving the guessed book name against
// the GUESSING PLAYER'S OWN VerseSource's Bible-order position — the same
// number VerseReference.BookNumber was assigned from the pool the round's
// verse was drawn from, since both ultimately derive from each source's
// own position in a standard, complete Bible ordering.

open System
open Xunit
open BibleGuessr.Domain

let private makeGuess book bookNumber chapter : Guess =
    { PlayerId = PlayerId(Guid.NewGuid())
      Book = book
      BookNumber = bookNumber
      Chapter = chapter
      VerseNumber = None
      SubmittedAt = DateTimeOffset.UtcNow }

[<Fact>]
let ``isCorrectGuess matches by book number even when the book names differ`` () =
    // The actual bug: "Dommerne" (round reference, server's spelling) vs.
    // "Dommer" (what the guessing player's own file calls it) — both
    // book number 7 in their respective sources.
    let reference: VerseReference = { Book = "Dommerne"; BookNumber = 7; Chapter = 3; VerseNumber = 1 }
    let guess = makeGuess "Dommer" (Some 7) (Some 3)

    Assert.True(Scoring.isCorrectGuess reference guess)

[<Fact>]
let ``isCorrectGuess is false when book numbers differ, even if names happen to match`` () =
    let reference: VerseReference = { Book = "Genesis"; BookNumber = 1; Chapter = 1; VerseNumber = 1 }
    // Contrived: same name, different number — number is authoritative.
    let guess = makeGuess "Genesis" (Some 2) (Some 1)

    Assert.False(Scoring.isCorrectGuess reference guess)

[<Fact>]
let ``isCorrectGuess falls back to name matching when the guess has no book number`` () =
    // A guessing player's own source failed to resolve a number for the
    // book they typed (e.g. free-text entry the source doesn't recognize
    // at all) — falls back to the pre-existing name comparison rather
    // than always failing, same forgiving spirit as the rest of this
    // codebase's guess handling.
    let reference: VerseReference = { Book = "Genesis"; BookNumber = 1; Chapter = 1; VerseNumber = 1 }
    let guess = makeGuess "Genesis" None (Some 1)

    Assert.True(Scoring.isCorrectGuess reference guess)

[<Fact>]
let ``isCorrectGuess still requires the chapter to match when one was guessed`` () =
    let reference: VerseReference = { Book = "Dommerne"; BookNumber = 7; Chapter = 3; VerseNumber = 1 }
    let guess = makeGuess "Dommer" (Some 7) (Some 4)

    Assert.False(Scoring.isCorrectGuess reference guess)

[<Fact>]
let ``isCorrectGuess matches with no chapter guessed`` () =
    let reference: VerseReference = { Book = "Dommerne"; BookNumber = 7; Chapter = 3; VerseNumber = 1 }
    let guess = makeGuess "Dommer" (Some 7) None

    Assert.True(Scoring.isCorrectGuess reference guess)
