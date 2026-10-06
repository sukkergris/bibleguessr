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

/// A draw that never favors the famous verses — the plain shuffle.
let private noFamousBias = 0

/// A draw that always favors the famous verses.
let private alwaysFamous = 100

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
    let picked = DailyQuiz.pick (fun upper -> Random(42).Next upper) noFamousBias 5 pool

    Assert.Equal(5, picked.Length)
    Assert.Equal(5, picked |> List.distinct |> List.length)

    for reference in picked do
        Assert.Contains(pool, fun v -> v.Book = reference.Book && v.Chapter = reference.Chapter && v.VerseNumber = reference.VerseNumber)

[<Fact>]
let ``the same verse in two translations counts once`` () =
    let twoTranslations = pool @ (pool |> List.map (fun v -> { v with Translation = "Other" }))
    let picked = DailyQuiz.pick firstCandidate noFamousBias twoTranslations.Length twoTranslations
    Assert.Equal(pool.Length, picked.Length)

[<Fact>]
let ``references carry the pool's own book numbers`` () =
    let picked = DailyQuiz.pick firstCandidate noFamousBias 1 pool
    Assert.Equal<VerseReference list>([ { Book = "1.Mosebog"; BookNumber = 1; Chapter = 1; VerseNumber = 1 } ], picked)

[<Fact>]
let ``a pool smaller than the quiz gives every verse it has`` () =
    Assert.Equal(pool.Length, (DailyQuiz.pick firstCandidate noFamousBias 50 pool).Length)

[<Fact>]
let ``an empty pool gives no quiz verses`` () =
    Assert.Empty(DailyQuiz.pick firstCandidate noFamousBias 5 [])

/// Numbered like the server's pool for its first six books, so the famous
/// list's book numbers (see FamousVerses.all) apply. The famous verses
/// come last, so taking the first remaining candidate only reaches them
/// by favoring them.
let private poolWithFamousVerses =
    [ verse "1.Mosebog" 1 2
      verse "2.Mosebog" 1 1
      verse "3.Mosebog" 1 1
      verse "4.Mosebog" 1 1
      verse "5.Mosebog" 30 17
      verse "Josua" 1 9
      verse "1.Mosebog" 9 4 // famous
      verse "5.Mosebog" 30 15 // famous
      verse "Josua" 1 8 ] // famous

let private famousInPool =
    set [ (1, 9, 4); (5, 30, 15); (6, 1, 8) ]

let private keyOf (reference: VerseReference) =
    reference.BookNumber, reference.Chapter, reference.VerseNumber

[<Fact>]
let ``a draw that favors the famous verses picks them`` () =
    let picked = DailyQuiz.pick firstCandidate alwaysFamous 3 poolWithFamousVerses
    Assert.Equal<Set<int * int * int>>(famousInPool, picked |> List.map keyOf |> Set.ofList)

[<Fact>]
let ``once the famous verses are used up, the rest of the quiz is drawn as usual`` () =
    let picked = DailyQuiz.pick firstCandidate alwaysFamous 5 poolWithFamousVerses

    Assert.Equal(5, picked |> List.distinct |> List.length)
    Assert.Equal<Set<int * int * int>>(famousInPool, picked |> List.take 3 |> List.map keyOf |> Set.ofList)
    Assert.All(picked |> List.skip 3, fun reference -> Assert.False(FamousVerses.isFamousReference reference))

[<Fact>]
let ``a draw that doesn't favor the famous verses ignores them`` () =
    let picked = DailyQuiz.pick firstCandidate noFamousBias 3 poolWithFamousVerses
    Assert.All(picked, fun reference -> Assert.False(FamousVerses.isFamousReference reference))
