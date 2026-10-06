module BibleGuessr.Tests.FamousVersesTests

// The famous verses a whole-Bible draw favors — see Domain/FamousVerses.fs
// and docs/web/famous-verses. The roll and the pick are pure and take
// their randomness as a function, so stubs make them predictable; the list
// itself is checked against the real bibelen-dk pool it's numbered for.

open Xunit
open BibleGuessr.Domain
open BibleGuessr.Api.BibelenDkLoader

let private verse book chapter verseNumber =
    Verse.create book chapter verseNumber "not used" "Test"

/// Always rolls/takes the first option.
let private first (_: int) = 0

/// Always rolls/takes the last option.
let private last (upper: int) = upper - 1

/// A chance that is the default, written out so the boundaries read plainly.
let private twentyPercent = 20

// "1.Mosebog" (Genesis) is book 1 in this pool, as in the server's, so
// Genesis 9:4 is famous here; Genesis 1:2 is not.
let private famousVerse = verse "1.Mosebog" 9 4
let private plainVerse = verse "1.Mosebog" 1 2
let private anotherPlainVerse = verse "1.Mosebog" 1 3
let private numbers = Verse.bookNumbers [ famousVerse; plainVerse; anotherPlainVerse ]

[<Fact>]
let ``a roll below the chance is a famous draw`` () =
    Assert.Equal(FamousVerses.Famous, FamousVerses.drawKind (fun _ -> twentyPercent - 1) twentyPercent)

[<Fact>]
let ``a roll at or above the chance is an ordinary draw`` () =
    Assert.Equal(FamousVerses.Any, FamousVerses.drawKind (fun _ -> twentyPercent) twentyPercent)

[<Fact>]
let ``a 0% chance is never a famous draw, and a 100% chance always is`` () =
    Assert.Equal(FamousVerses.Any, FamousVerses.drawKind first 0)
    Assert.Equal(FamousVerses.Famous, FamousVerses.drawKind last 100)

[<Fact>]
let ``a famous draw picks among the famous candidates only`` () =
    // `first` rolls 0 (a famous draw), then takes the first candidate it's
    // offered — which would be the plain verse if the famous ones weren't
    // singled out.
    let picked = FamousVerses.pickOne first twentyPercent numbers [ plainVerse; famousVerse ]
    Assert.Equal(famousVerse, picked)

[<Fact>]
let ``a famous draw with no famous candidates picks any of them`` () =
    let picked = FamousVerses.pickOne first twentyPercent numbers [ plainVerse; anotherPlainVerse ]
    Assert.Equal(plainVerse, picked)

[<Fact>]
let ``an ordinary draw can pick a plain verse even when a famous one is in play`` () =
    // `last` rolls 99 (an ordinary draw), then takes the last candidate.
    let picked = FamousVerses.pickOne last twentyPercent numbers [ famousVerse; plainVerse ]
    Assert.Equal(plainVerse, picked)

[<Fact>]
let ``a verse is famous by its pool's book number, not its book name`` () =
    // Here "1.Mosebog" is book 2, so its 9:4 is not the famous Genesis 9:4.
    let otherNumbers = Verse.bookNumbers [ verse "Indledning" 1 1; famousVerse ]
    Assert.False(FamousVerses.isFamous otherNumbers famousVerse)
    Assert.True(FamousVerses.isFamous numbers famousVerse)

[<Fact>]
let ``the list has no duplicates`` () =
    Assert.Equal(FamousVerses.all.Length, FamousVerses.all |> List.distinct |> List.length)

/// The server pool's name for every book the list uses — pins
/// FamousVerses.Book's numbering, which is the pool's own (Lutheran)
/// order, not NWT's.
let private expectedBookNames =
    [ FamousVerses.Book.genesis, "1.Mosebog"
      FamousVerses.Book.exodus, "2.Mosebog"
      FamousVerses.Book.deuteronomy, "5.Mosebog"
      FamousVerses.Book.joshua, "Josua"
      FamousVerses.Book.job, "Job"
      FamousVerses.Book.psalms, "Salme"
      FamousVerses.Book.proverbs, "Ordsprogene"
      FamousVerses.Book.ecclesiastes, "Prædikeren"
      FamousVerses.Book.isaiah, "Esajas"
      FamousVerses.Book.jeremiah, "Jeremias"
      FamousVerses.Book.ezekiel, "Ezekiel"
      FamousVerses.Book.daniel, "Daniel"
      FamousVerses.Book.joel, "Joel"
      FamousVerses.Book.micah, "Mikas"
      FamousVerses.Book.zephaniah, "Zefanias"
      FamousVerses.Book.malachi, "Malakias"
      FamousVerses.Book.matthew, "Matt."
      FamousVerses.Book.luke, "Lukas"
      FamousVerses.Book.john, "Johannes"
      FamousVerses.Book.acts, "Apostelenes gerninger"
      FamousVerses.Book.romans, "Romerne"
      FamousVerses.Book.corinthians1, "1.Korinterne"
      FamousVerses.Book.corinthians2, "2.Korinterne"
      FamousVerses.Book.philippians, "Filipperne"
      FamousVerses.Book.timothy1, "1.Timoteus"
      FamousVerses.Book.timothy2, "2.Timoteus"
      FamousVerses.Book.hebrews, "Hebræerne"
      FamousVerses.Book.peter1, "1.Peter"
      FamousVerses.Book.peter2, "2.Peter"
      FamousVerses.Book.john1, "1.Johannes"
      FamousVerses.Book.james, "Jakob"
      FamousVerses.Book.revelation, "Aabenbaringen" ]

[<Fact>]
let ``each book number is that book's number in the server's bibelen-dk pool`` () =
    let verses = loadFromZip TestPaths.bibelenDkArchive

    for bookNumber, name in expectedBookNames do
        Assert.Equal(Some name, Verse.bookAtNumber verses bookNumber)

[<Fact>]
let ``every famous verse is in the server's bibelen-dk pool`` () =
    let verses = loadFromZip TestPaths.bibelenDkArchive
    let numbersByBookName = Verse.bookNumbers verses

    for famous in FamousVerses.all do
        Assert.True(
            verses |> List.exists (fun v ->
                numbersByBookName.TryFind v.Book = Some famous.BookNumber
                && v.Chapter = famous.Chapter
                && v.VerseNumber = famous.VerseNumber),
            $"{famous.BookNumber} {famous.Chapter},{famous.VerseNumber} is not in the pool"
        )

[<Fact>]
let ``the list's references come in Bible order, with the pool's book names`` () =
    // A pool with only the first book: just its famous verses, sorted by
    // chapter and verse — though FamousVerses.all lists 9,4 first.
    let genesisOnly = [ verse "1.Mosebog" 1 1 ]

    let references = FamousVerses.referencesIn genesisOnly

    Assert.Equal<(string * int * int) list>(
        [ "1.Mosebog", 1, 1
          "1.Mosebog", 1, 28
          "1.Mosebog", 2, 7
          "1.Mosebog", 2, 17
          "1.Mosebog", 3, 4
          "1.Mosebog", 3, 15
          "1.Mosebog", 3, 19
          "1.Mosebog", 9, 4
          "1.Mosebog", 22, 18 ],
        references |> List.map (fun r -> r.Book, r.Chapter, r.VerseNumber)
    )

[<Fact>]
let ``against the server's pool, every famous verse is listed, in book order`` () =
    let references = FamousVerses.referencesIn (loadFromZip TestPaths.bibelenDkArchive)

    Assert.Equal(FamousVerses.all.Length, references.Length)

    let keys = references |> List.map (fun r -> r.BookNumber, r.Chapter, r.VerseNumber)
    Assert.Equal<(int * int * int) list>(List.sort keys, keys)

    Assert.Contains({ Book = "Jakob"; BookNumber = 64; Chapter = 1; VerseNumber = 13 }, references)
