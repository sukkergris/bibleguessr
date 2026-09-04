module BibleGuessr.Tests.BookNumberTests

// Covers Verse.bookNumbers — the fix for a real bug: two players in a
// multiplayer game may each have a different translation/uploaded file,
// and those files spell book names differently (even the SAME translation
// can have parsing artifacts — bibelen-dk's own loader once produced both
// "Jeremias" and "Jeremias." as if they were different books). Matching a
// verse reference across players by NAME is fragile; this assigns each
// book a stable NUMBER instead, derived from its own 1-based rank of
// first encounter in a verse list's natural (file-read) order — the same
// "Bible order" every existing loader/endpoint already produces (see
// Program.fs's /api/books-in-bible-order), just finally captured as a
// number instead of being derived-and-discarded every time.

open Xunit
open BibleGuessr.Domain

let private verse book chapter =
    Verse.create book chapter 1 "text" "Test Translation"

[<Fact>]
let ``the first book encountered is numbered 1`` () =
    let verses = [ verse "Genesis" 1; verse "Genesis" 2 ]
    let numbers = Verse.bookNumbers verses

    Assert.Equal(1, numbers["Genesis"])

[<Fact>]
let ``books are numbered by order of first encounter, not alphabetically`` () =
    let verses = [ verse "Zephaniah" 1; verse "Amos" 1 ]
    let numbers = Verse.bookNumbers verses

    Assert.Equal(1, numbers["Zephaniah"])
    Assert.Equal(2, numbers["Amos"])

[<Fact>]
let ``repeated verses from the same book don't advance its number or add duplicates`` () =
    let verses = [ verse "Genesis" 1; verse "Genesis" 2; verse "Genesis" 3; verse "Exodus" 1 ]
    let numbers = Verse.bookNumbers verses

    Assert.Equal(1, numbers["Genesis"])
    Assert.Equal(2, numbers["Exodus"])
    Assert.Equal(2, numbers.Count)

[<Fact>]
let ``two differently-spelled book names in the same position across two lists get the same number`` () =
    // This is the actual bug this exists to fix: "Dommer" (one file's
    // spelling of Judges) and "Dommerne" (another's) both being the 7th
    // book encountered in their respective, otherwise-identical-order
    // verse lists.
    let listA =
        [ verse "1.Mosebog" 1
          verse "2.Mosebog" 1
          verse "3.Mosebog" 1
          verse "4.Mosebog" 1
          verse "5.Mosebog" 1
          verse "Josua" 1
          verse "Dommer" 1 ]

    let listB =
        [ verse "1.Mosebog" 1
          verse "2.Mosebog" 1
          verse "3.Mosebog" 1
          verse "4.Mosebog" 1
          verse "5.Mosebog" 1
          verse "Josua" 1
          verse "Dommerne" 1 ]

    let numbersA = Verse.bookNumbers listA
    let numbersB = Verse.bookNumbers listB

    Assert.Equal(numbersA["Dommer"], numbersB["Dommerne"])
    Assert.Equal(7, numbersA["Dommer"])

[<Fact>]
let ``bookNumberOf looks up one book's number, or None if it's not present`` () =
    let verses = [ verse "Genesis" 1; verse "Exodus" 1 ]

    Assert.Equal(Some 1, Verse.bookNumberOf verses "Genesis")
    Assert.Equal(Some 2, Verse.bookNumberOf verses "Exodus")
    Assert.Equal(None, Verse.bookNumberOf verses "Leviticus")

[<Fact>]
let ``bookNumberOf is case-insensitive`` () =
    let verses = [ verse "Genesis" 1 ]

    Assert.Equal(Some 1, Verse.bookNumberOf verses "genesis")
    Assert.Equal(Some 1, Verse.bookNumberOf verses "GENESIS")

[<Fact>]
let ``bookAtNumber returns the book name at a given position, or None if out of range`` () =
    let verses = [ verse "Genesis" 1; verse "Exodus" 1; verse "Leviticus" 1 ]

    Assert.Equal(Some "Genesis", Verse.bookAtNumber verses 1)
    Assert.Equal(Some "Exodus", Verse.bookAtNumber verses 2)
    Assert.Equal(None, Verse.bookAtNumber verses 4)
    Assert.Equal(None, Verse.bookAtNumber verses 0)

[<Fact>]
let ``matchesRestrictionByNumber with an empty book set matches everything`` () =
    let verses = [ verse "Genesis" 1 ]
    Assert.True(Verse.matchesRestrictionByNumber (Verse.bookNumbers verses) Set.empty Map.empty (verse "Genesis" 1))

[<Fact>]
let ``matchesRestrictionByNumber excludes a verse whose book number isn't selected`` () =
    let verses = [ verse "Genesis" 1; verse "Exodus" 1 ]
    let books = Set.ofList [ 1 ] // Genesis

    Assert.True(Verse.matchesRestrictionByNumber (Verse.bookNumbers verses) books Map.empty (verse "Genesis" 1))
    Assert.False(Verse.matchesRestrictionByNumber (Verse.bookNumbers verses) books Map.empty (verse "Exodus" 1))

[<Fact>]
let ``matchesRestrictionByNumber narrows to specific chapters by book number`` () =
    let verses = [ verse "Genesis" 1; verse "Genesis" 4 ]
    let books = Set.ofList [ 1 ]
    let chaptersByBook = Map.ofList [ 1, Set.ofList [ 1 ] ]

    Assert.True(Verse.matchesRestrictionByNumber (Verse.bookNumbers verses) books chaptersByBook (verse "Genesis" 1))
    Assert.False(Verse.matchesRestrictionByNumber (Verse.bookNumbers verses) books chaptersByBook (verse "Genesis" 4))

[<Fact>]
let ``matchesRestrictionByNumber matches across two differently-spelled sources at the same position`` () =
    // The actual bug this exists to fix: the CHALLENGER selected "Dommer"
    // (spelling in their own source), which resolved to book number 7;
    // the SERVER's own pool spells the same book "Dommerne" — this must
    // still match, by number, regardless of the server's spelling.
    let serverVerses =
        [ verse "1.Mosebog" 1
          verse "2.Mosebog" 1
          verse "3.Mosebog" 1
          verse "4.Mosebog" 1
          verse "5.Mosebog" 1
          verse "Josua" 1
          verse "Dommerne" 5 ]

    let books = Set.ofList [ 7 ] // whatever number the CHALLENGER's own source assigned "Dommer"

    Assert.True(Verse.matchesRestrictionByNumber (Verse.bookNumbers serverVerses) books Map.empty (verse "Dommerne" 5))
    Assert.False(Verse.matchesRestrictionByNumber (Verse.bookNumbers serverVerses) books Map.empty (verse "Josua" 1))
