module BibleGuessr.Tests.VerseHealthTests

// Covers VerseHealth.evaluate — the fix for a real bug: the published API
// image shipped with no Bible data, logged "Verses loaded: 0", and its
// health endpoint still answered "ok" while every game was unplayable.
// See docs/SCRUM/DONE/Feature.ShipBibleWithApiImage.md.

open Xunit
open BibleGuessr.Api.VerseHealth

[<Fact>]
let ``zero loaded verses is reported as NoVerses, not healthy`` () =
    Assert.Equal(NoVerses, evaluate 0)

[<Fact>]
let ``a non-zero verse count is healthy and carries the count`` () =
    Assert.Equal(Healthy 31102, evaluate 31102)
