module BibleGuessr.Tests.GameTypeNumberTests

// GameType.Books/Chapters carry book NUMBERS (not names) — see
// BookNumberTests.fs's doc comment for why. The challenger picks books
// from their OWN VerseSource and sends book numbers (derived from their
// own source's Bible order); the server matches those numbers against ITS
// OWN pool's book numbers (see Verse.matchesRestrictionByNumber), so a
// challenger's "Dommer" and the server's "Dommerne" — the same book,
// spelled differently — still match correctly.

open Xunit
open BibleGuessr.Domain

[<Fact>]
let ``restrictionOf AllVerses is unrestricted`` () =
    let books, chaptersByBook = GameType.restrictionOf AllVerses

    Assert.True(books.IsEmpty)
    Assert.True(chaptersByBook.IsEmpty)

[<Fact>]
let ``restrictionOf Books carries the book numbers as a set`` () =
    let books, chaptersByBook = GameType.restrictionOf (Books [ 1; 7 ])

    Assert.Equal<Set<int>>(Set.ofList [ 1; 7 ], books)
    Assert.True(chaptersByBook.IsEmpty)

[<Fact>]
let ``restrictionOf Chapters carries book numbers and their chapter sets`` () =
    let books, chaptersByBook = GameType.restrictionOf (Chapters(Map.ofList [ 1, [ 1; 2; 3 ] ]))

    Assert.Equal<Set<int>>(Set.ofList [ 1 ], books)
    Assert.Equal<Set<int>>(Set.ofList [ 1; 2; 3 ], chaptersByBook[1])
