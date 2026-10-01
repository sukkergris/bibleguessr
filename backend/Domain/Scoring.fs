namespace BibleGuessr.Domain

// The shared kernel's scoring vocabulary and standard rules. Compiled
// before GameTypes/ so every game type can build its own rules from these
// — see GameType.scoreGuess. Nothing here may know about a particular
// game type.

open System

type PlayerId = PlayerId of Guid

/// A guess a player submits for the current round's verse. Chapter and
/// VerseNumber are optional — a player can guess just the book — but
/// VerseNumber only makes sense alongside a Chapter guess.
///
/// BookNumber is the guessed book's 1-based position in the GUESSING
/// PLAYER'S OWN VerseSource's Bible order (see
/// frontend/src/shared-kernel/book-numbers.ts) — set alongside `Book` (which stays for
/// display/singleplayer purposes) so multiplayer scoring can match by
/// number rather than name (see Scoring.isCorrectGuess and
/// VerseReference's doc comment on why name matching isn't reliable
/// across two players' different translations/files). None if the
/// player's own source couldn't resolve a number for what they typed
/// (falls back to name matching — see isCorrectGuess).
type Guess =
    { PlayerId: PlayerId
      Book: string
      BookNumber: int option
      Chapter: int option
      VerseNumber: int option
      SubmittedAt: DateTimeOffset }

/// A round's time limit, chosen by the challenger via a slider from
/// "infinite" to 1 minute (see docs/SCRUM/Feature.Time.md). An explicit DU
/// rather than TimeSpan option so "no limit" is a named case every
/// consumer (Scoring, the round-timeout sweep) must handle explicitly,
/// rather than an ambiguous None that could be misread as "not set yet".
type TimeLimit =
    | Unlimited
    | LimitedTo of TimeSpan

/// How one guess scored under a game type's rule.
type GuessScore = { Correct: bool; Points: int }

module Scoring =

    /// Points for a correct guess in a round without a time limit — there's
    /// no "time remaining" fraction to decay against.
    let unlimitedCorrectPoints = 100

    /// Points for a correct guess, decreasing the longer a player takes to answer.
    /// `elapsed` is time since the round started; `roundLength` is the total time allowed.
    let pointsForGuess (roundLength: TimeSpan) (elapsed: TimeSpan) (correct: bool) =
        if not correct then
            0
        else
            let remainingFraction =
                1.0 - (elapsed.TotalSeconds / roundLength.TotalSeconds) |> max 0.0

            let basePoints = 100
            let bonus = int (float basePoints * remainingFraction)
            basePoints + bonus

    /// Used to score multiplayer rounds (see GameSession.scoreRound) —
    /// matches the book by NUMBER, not name, whenever the guess has one:
    /// `guess`/`verse` may come from two different players' own
    /// translations/uploaded files, which can spell the same book
    /// differently (see VerseReference's doc comment). Falls back to name
    /// matching only if the guess has no BookNumber at all (the guessing
    /// player's own source couldn't resolve one for what they typed).
    let isCorrectGuess (verse: VerseReference) (guess: Guess) =
        let bookMatches =
            match guess.BookNumber with
            | Some bookNumber -> bookNumber = verse.BookNumber
            | None -> String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

        match guess.Chapter with
        | Some chapter -> bookMatches && chapter = verse.Chapter
        | None -> bookMatches

    /// Points awarded per level of a guess, each gated on every level before
    /// it being correct: the book alone is worth 10; the chapter only
    /// counts (100 more) if the book was also right; the verse number only
    /// counts (1000 more) if both book and chapter were right. An omitted
    /// Chapter/VerseNumber guess simply can't earn that level's points.
    let private bookPoints = 10
    let private chapterPoints = 100
    let private verseNumberPoints = 1000

    let pointsForVerseGuess (verse: VerseReference) (guess: Guess) =
        let bookCorrect =
            String.Equals(guess.Book, verse.Book, StringComparison.OrdinalIgnoreCase)

        if not bookCorrect then
            0
        else
            let chapterCorrect =
                match guess.Chapter with
                | Some chapter -> chapter = verse.Chapter
                | None -> false

            if not chapterCorrect then
                bookPoints
            else
                let verseNumberCorrect =
                    match guess.VerseNumber with
                    | Some verseNumber -> verseNumber = verse.VerseNumber
                    | None -> false

                if verseNumberCorrect then
                    bookPoints + chapterPoints + verseNumberPoints
                else
                    bookPoints + chapterPoints

    /// The standard multiplayer rule: a guess is correct when its book
    /// (and chapter, if guessed) match — see isCorrectGuess — and earns
    /// pointsForGuess's decaying points in a timed round, or
    /// unlimitedCorrectPoints in an untimed one. A game type uses this
    /// unless it defines its own rule (see GameTypes/ and
    /// GameType.scoreGuess).
    let standardMultiplayer (timeLimit: TimeLimit) (elapsed: TimeSpan) (verse: VerseReference) (guess: Guess) : GuessScore =
        let correct = isCorrectGuess verse guess

        let points =
            match timeLimit with
            | Unlimited -> if correct then unlimitedCorrectPoints else 0
            | LimitedTo roundLength -> pointsForGuess roundLength elapsed correct

        { Correct = correct; Points = points }
