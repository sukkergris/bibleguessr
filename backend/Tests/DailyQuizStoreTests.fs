module BibleGuessr.Tests.DailyQuizStoreTests

// The daily quiz's SQLite storage and the get-or-create rule on top of it —
// see Api/Database.fs, Api/DailyQuizStore.fs, Api/DailyQuizService.fs and
// docs/web/daily-quiz. Runs against an in-memory SQLite database: the same
// engine and SQL as the file used in production, nothing to clean up.

open System
open Microsoft.Data.Sqlite
open Xunit
open BibleGuessr.Domain
open BibleGuessr.Api

/// A fresh, private in-memory database. It lives as long as `Keeper` stays
/// open; every other connection to the same connection string shares it.
type private InMemoryDatabase() =
    let connectionString =
        SqliteConnectionStringBuilder(
            DataSource = $"daily-quiz-tests-{Guid.NewGuid()}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared
        )
            .ToString()

    let keeper = new SqliteConnection(connectionString)
    do keeper.Open()
    do Database.migrate connectionString

    member _.ConnectionString = connectionString

    interface IDisposable with
        member _.Dispose() = keeper.Dispose()

let private today = DateOnly(2026, 10, 1)
let private createdAt = DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero)

let private reference book bookNumber chapter verseNumber : VerseReference =
    { Book = book
      BookNumber = bookNumber
      Chapter = chapter
      VerseNumber = verseNumber }

let private quiz =
    { Date = today
      Verses =
        [ reference "Rut" 8 1 16
          reference "1.Mosebog" 1 1 1
          reference "Johannes" 43 3 16 ] }

let private verse book chapter verseNumber : Verse =
    { Book = book
      Chapter = chapter
      VerseNumber = verseNumber
      Text = "not used"
      Translation = "Test"
      Reference = "" }

let private pool = [ for chapter in 1..3 do for v in 1..4 -> verse "1.Mosebog" chapter v ]

let private settings: DailyQuizService.Settings = { VerseCount = 5 }

/// These tests are about storing a quiz, not about which verses it draws.
let private noFamousBias: FamousVerses.Settings = { ChancePercent = 0 }

[<Fact>]
let ``migrating twice leaves the schema at the latest version`` () =
    use db = new InMemoryDatabase()
    Database.migrate db.ConnectionString
    Assert.Equal(Database.latestSchemaVersion, Database.schemaVersion db.ConnectionString)

[<Fact>]
let ``a stored quiz reads back with its verses in order`` () =
    use db = new InMemoryDatabase()
    Assert.True(DailyQuizStore.tryAdd db.ConnectionString createdAt quiz)
    Assert.Equal(Some quiz, DailyQuizStore.tryGet db.ConnectionString today)

[<Fact>]
let ``a day without a quiz reads as none`` () =
    use db = new InMemoryDatabase()
    Assert.Equal(None, DailyQuizStore.tryGet db.ConnectionString today)

[<Fact>]
let ``a second quiz for the same day is refused and the first one kept`` () =
    use db = new InMemoryDatabase()
    Assert.True(DailyQuizStore.tryAdd db.ConnectionString createdAt quiz)

    let other = { quiz with Verses = [ reference "Salme" 19 23 1 ] }
    Assert.False(DailyQuizStore.tryAdd db.ConnectionString createdAt other)
    Assert.Equal(Some quiz, DailyQuizStore.tryGet db.ConnectionString today)

[<Fact>]
let ``getOrCreate creates the day's quiz once and then returns that same quiz`` () =
    use db = new InMemoryDatabase()
    let first = DailyQuizService.getOrCreate db.ConnectionString settings noFamousBias pool (fun upper -> Random(1).Next upper) createdAt today
    let second = DailyQuizService.getOrCreate db.ConnectionString settings noFamousBias pool (fun upper -> Random(2).Next upper) createdAt today

    Assert.True(first.IsSome)
    Assert.Equal(settings.VerseCount, first.Value.Verses.Length)
    Assert.Equal(first, second)

[<Fact>]
let ``each day gets its own quiz`` () =
    use db = new InMemoryDatabase()
    let pickFirst (_: int) = 0
    let pickLast upper = upper - 1
    let todays = DailyQuizService.getOrCreate db.ConnectionString settings noFamousBias pool pickFirst createdAt today
    let tomorrows = DailyQuizService.getOrCreate db.ConnectionString settings noFamousBias pool pickLast createdAt (today.AddDays 1)

    Assert.Equal(today.AddDays 1, tomorrows.Value.Date)
    Assert.NotEqual<VerseReference list>(todays.Value.Verses, tomorrows.Value.Verses)
    Assert.Equal(todays, DailyQuizStore.tryGet db.ConnectionString today)

[<Fact>]
let ``no verses means no quiz, and nothing is stored`` () =
    use db = new InMemoryDatabase()
    Assert.Equal(None, DailyQuizService.getOrCreate db.ConnectionString settings noFamousBias [] (fun _ -> 0) createdAt today)
    Assert.Equal(None, DailyQuizStore.tryGet db.ConnectionString today)
