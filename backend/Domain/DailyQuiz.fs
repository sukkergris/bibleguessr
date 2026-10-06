namespace BibleGuessr.Domain

open System

/// One day's quiz: a fixed set of verses everyone plays that day — see
/// docs/web/daily-quiz. Only REFERENCES (book number, chapter, verse
/// number, plus the server pool's own book spelling for display), never
/// verse text: each player resolves the text from their own source, the
/// same way a multiplayer round does (see VerseReference).
type DailyQuiz =
    { /// The UTC day this quiz is for — see DailyQuiz.dateOf.
      Date: DateOnly
      /// In the order they're played.
      Verses: VerseReference list }

module DailyQuiz =
    /// The UTC day `now` belongs to. A new quiz starts at 00:00 UTC for
    /// every player, wherever they are.
    let dateOf (now: DateTimeOffset) : DateOnly = DateOnly.FromDateTime now.UtcDateTime

    /// When the next UTC day — and so the next quiz — starts.
    let nextMidnightUtc (now: DateTimeOffset) : DateTimeOffset =
        DateTimeOffset(now.UtcDateTime.Date.AddDays 1.0, TimeSpan.Zero)

    /// Draws `count` distinct verses from `verses` (fewer if the pool is
    /// smaller). The same verse in several translations counts once. Each
    /// verse has a `famousChancePercent` chance of being one of the famous
    /// verses not yet drawn (see FamousVerses), if any are left.
    /// `nextIndex upper` returns a random index in [0, upper) — passed in so
    /// this stays pure and testable; the caller supplies the randomness.
    let pick (nextIndex: int -> int) (famousChancePercent: int) (count: int) (verses: Verse list) : VerseReference list =
        let numbersByBookName = Verse.bookNumbers verses

        let candidates =
            verses
            |> List.map (Verse.referenceOfIn numbersByBookName)
            |> List.distinctBy (fun r -> r.BookNumber, r.Chapter, r.VerseNumber)
            |> List.toArray

        let picks = min count candidates.Length

        let anyRemaining i = i + nextIndex (candidates.Length - i)

        // A partial Fisher–Yates shuffle: only the first `picks` positions
        // are shuffled, which is all a quiz needs. Positions before `i` are
        // already drawn, so picking from `i` on keeps the quiz distinct.
        for i in 0 .. picks - 1 do
            let j =
                match FamousVerses.drawKind nextIndex famousChancePercent with
                | FamousVerses.Famous ->
                    let famousRemaining =
                        [| for k in i .. candidates.Length - 1 do
                               if FamousVerses.isFamousReference candidates[k] then
                                   k |]

                    if famousRemaining.Length = 0 then
                        anyRemaining i
                    else
                        famousRemaining[nextIndex famousRemaining.Length]
                | FamousVerses.Any -> anyRemaining i


            let chosen = candidates[j]
            candidates[j] <- candidates[i]
            candidates[i] <- chosen

        candidates |> Array.take picks |> Array.toList
