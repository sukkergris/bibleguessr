module BibleGuessr.Tests.DailyQuizTests

// The daily quiz's pure rules — see Domain/DailyQuiz.fs and
// docs/web/daily-quiz. Which day a moment belongs to and when the next one
// starts are always decided in UTC, and a quiz is a fixed number of
// distinct verses drawn from the whole pool.

open System
open Xunit
open BibleGuessr.Domain

let private verse book chapter verseNumber : Verse =
    { Book = book
      Chapter = chapter
      VerseNumber = verseNumber
      Text = "not used"
      Translation = "Test"
      Reference = $"{book} {chapter}:{verseNumber}" }

let private pool =
    [ verse "1.Mosebog" 1 1
      verse "1.Mosebog" 1 2
      verse "2.Mosebog" 3 14
      verse "Rut" 1 16
      verse "Salme" 23 1
      verse "Johannes" 3 16
      verse "Aabenbaringen" 22 21 ]

/// Always takes the first remaining candidate — makes the pick predictable.
let private firstCandidate (_: int) = 0

[<Fact>]
let ``the date is the UTC date, whatever the offset`` () =
    let lateEveningInCopenhagen = DateTimeOffset(2026, 10, 1, 1, 30, 0, TimeSpan.FromHours 2.0)
    Assert.Equal(DateOnly(2026, 9, 30), DailyQuiz.dateOf lateEveningInCopenhagen)

[<Fact>]
let ``a new day starts at 00:00 UTC`` () =
    Assert.Equal(DateOnly(2026, 9, 30), DailyQuiz.dateOf (DateTimeOffset(2026, 9, 30, 23, 59, 59, TimeSpan.Zero)))
    Assert.Equal(DateOnly(2026, 10, 1), DailyQuiz.dateOf (DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero)))

[<Fact>]
let ``the next midnight is the start of the next UTC day`` () =
    let now = DateTimeOffset(2026, 10, 1, 13, 45, 0, TimeSpan.FromHours 2.0)
    Assert.Equal(DateTimeOffset(2026, 10, 2, 0, 0, 0, TimeSpan.Zero), DailyQuiz.nextMidnightUtc now)

[<Fact>]
let ``at midnight exactly, the next midnight is a day away`` () =
    let midnight = DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero)
    Assert.Equal(midnight.AddDays 1.0, DailyQuiz.nextMidnightUtc midnight)

[<Fact>]
let ``a quiz is the requested number of distinct verses from the pool`` () =
    let picked = DailyQuiz.pick (fun upper -> Random(42).Next upper) 5 pool

    Assert.Equal(5, picked.Length)
    Assert.Equal(5, picked |> List.distinct |> List.length)

    for reference in picked do
        Assert.Contains(pool, fun v -> v.Book = reference.Book && v.Chapter = reference.Chapter && v.VerseNumber = reference.VerseNumber)

[<Fact>]
let ``the same verse in two translations counts once`` () =
    let twoTranslations = pool @ (pool |> List.map (fun v -> { v with Translation = "Other" }))
    let picked = DailyQuiz.pick firstCandidate twoTranslations.Length twoTranslations
    Assert.Equal(pool.Length, picked.Length)

[<Fact>]
let ``references carry the pool's own book numbers`` () =
    let picked = DailyQuiz.pick firstCandidate 1 pool
    Assert.Equal<VerseReference list>([ { Book = "1.Mosebog"; BookNumber = 1; Chapter = 1; VerseNumber = 1 } ], picked)

[<Fact>]
let ``a pool smaller than the quiz gives every verse it has`` () =
    Assert.Equal(pool.Length, (DailyQuiz.pick firstCandidate 50 pool).Length)

[<Fact>]
let ``an empty pool gives no quiz verses`` () =
    Assert.Empty(DailyQuiz.pick firstCandidate 5 [])
