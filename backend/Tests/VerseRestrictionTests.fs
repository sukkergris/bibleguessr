module BibleGuessr.Tests.VerseRestrictionTests

open Xunit
open BibleGuessr.Domain

let private verse book chapter =
    Verse.create book chapter 1 "text" "Test Translation"

[<Fact>]
let ``empty books set matches everything (default ALL)`` () =
    Assert.True(Verse.matchesRestriction Set.empty Map.empty (verse "Genesis" 1))
    Assert.True(Verse.matchesRestriction Set.empty Map.empty (verse "Revelation" 22))

[<Fact>]
let ``a book not in the restriction is excluded`` () =
    let books = Set.ofList [ "Genesis" ]
    Assert.False(Verse.matchesRestriction books Map.empty (verse "Exodus" 1))

[<Fact>]
let ``a selected book with no chapter narrowing matches all of its chapters`` () =
    let books = Set.ofList [ "Genesis" ]
    Assert.True(Verse.matchesRestriction books Map.empty (verse "Genesis" 1))
    Assert.True(Verse.matchesRestriction books Map.empty (verse "Genesis" 50))

[<Fact>]
let ``a selected book narrowed to specific chapters only matches those chapters`` () =
    let books = Set.ofList [ "Genesis" ]
    let chaptersByBook = Map.ofList [ "Genesis", Set.ofList [ 1; 2; 3 ] ]

    Assert.True(Verse.matchesRestriction books chaptersByBook (verse "Genesis" 1))
    Assert.False(Verse.matchesRestriction books chaptersByBook (verse "Genesis" 4))

[<Fact>]
let ``chapter narrowing for one book does not affect another selected book`` () =
    let books = Set.ofList [ "Genesis"; "Exodus" ]
    let chaptersByBook = Map.ofList [ "Genesis", Set.ofList [ 1 ] ]

    // Exodus has no entry in chaptersByBook, so all its chapters match.
    Assert.True(Verse.matchesRestriction books chaptersByBook (verse "Exodus" 20))
    Assert.False(Verse.matchesRestriction books chaptersByBook (verse "Genesis" 2))

[<Fact>]
let ``a chapter restriction on a book not in the selected set still excludes it`` () =
    // chaptersByBook entries are only meaningful for books actually in
    // `books` — a stray entry for an unselected book shouldn't matter.
    let books = Set.ofList [ "Genesis" ]
    let chaptersByBook = Map.ofList [ "Exodus", Set.ofList [ 1 ] ]

    Assert.False(Verse.matchesRestriction books chaptersByBook (verse "Exodus" 1))
