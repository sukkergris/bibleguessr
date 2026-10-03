namespace BibleGuessr.Domain

// The shared kernel's scoring vocabulary and building blocks. Compiled
// before GameTypes/ so every game type can build its own rule from these
// — see GameType.scoreGuess. Nothing here may know about a particular
// game type. Mirrors frontend/src/shared-kernel/scoring.ts: multiplayer
// scores a guess exactly like singleplayer does (see docs/web/scoring).

open System

type PlayerId = PlayerId of Guid

/// A guess a player submits for the current round's verse. Chapter and
/// VerseNumber are optional — a player can guess just the book — but
/// VerseNumber only makes sense alongside a Chapter guess.
///
/// BookNumber is the guessed book's 1-based position in the GUESSING
/// PLAYER'S OWN VerseSource's Bible order (see
/// frontend/src/shared-kernel/book-numbers.ts) — set alongside `Book` (which stays for
/// display purposes) so scoring can match by number rather than name (see
/// Scoring.correctParts and VerseReference's doc comment on why name
/// matching isn't reliable across two players' different
/// translations/files). None if the player's own source couldn't resolve
/// a number for what they typed (falls back to name matching — see
/// correctParts).
type Guess =
    { PlayerId: PlayerId
      Book: string
      BookNumber: int option
      Chapter: int option
      VerseNumber: int option
      SubmittedAt: DateTimeOffset }

/// What each part of a guess earns when it is right. A game type builds
/// its own rule by choosing its tiers — e.g. 0 for a part that is given
/// at setup. Field names differ from Guess's so F# never mistakes one
/// record for the other.
type ScoringTiers =
    { BookPoints: int
      ChapterPoints: int
      VerseNumberPoints: int }

/// Which parts of a guess count as right — see Scoring.correctParts.
type CorrectParts =
    { BookRight: bool
      ChapterRight: bool
      VerseNumberRight: bool }

module Scoring =

    /// The standard tiers: the book 10, the chapter 100 more, the verse
    /// number 1000 more — 1110 for everything.
    let standardTiers =
        { BookPoints = 10
          ChapterPoints = 100
          VerseNumberPoints = 1000 }

    let private sameName (a: string) (b: string) =
        String.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase)

    /// Which parts of `guess` are right. Each part only counts when every
    /// part before it is right too — the right numbers in the wrong book
    /// count for nothing — and a part that wasn't guessed isn't right.
    ///
    /// The book matches by NUMBER whenever the guess has one: `guess` and
    /// `verse` may come from two different players' own translations or
    /// uploaded files, which can spell the same book differently (see
    /// VerseReference's doc comment). Names are compared (ignoring case and
    /// surrounding whitespace) only when the guessing player's own source
    /// couldn't resolve a number at all.
    let correctParts (verse: VerseReference) (guess: Guess) : CorrectParts =
        let bookRight =
            match guess.BookNumber with
            | Some bookNumber -> bookNumber = verse.BookNumber
            | None -> sameName guess.Book verse.Book

        let chapterRight = bookRight && guess.Chapter = Some verse.Chapter
        let verseNumberRight = chapterRight && guess.VerseNumber = Some verse.VerseNumber

        { BookRight = bookRight
          ChapterRight = chapterRight
          VerseNumberRight = verseNumberRight }

    /// The points `guess` earns against `verse` with `tiers`: the tier of
    /// every part that is right (see correctParts).
    let tieredPoints (tiers: ScoringTiers) (verse: VerseReference) (guess: Guess) : int =
        let parts = correctParts verse guess
        let pointsIf right points = if right then points else 0

        pointsIf parts.BookRight tiers.BookPoints
        + pointsIf parts.ChapterRight tiers.ChapterPoints
        + pointsIf parts.VerseNumberRight tiers.VerseNumberPoints
