module BibleGuessr.Tests.BibelenDkLoaderTests

// Covers BibelenDkLoader.normalizeBookNames — fixes a real data-quality
// artifact in the scraped source (bibles/bibelen-dk/src/Bibelen Files.zip):
// three chapters of Jeremiah (29, 46, 48) title their book "Jeremias."
// (trailing period) instead of "Jeremias", making the loader see 67
// distinct books instead of 66. This isn't cosmetic — every book NUMBER
// downstream (see BibleGuessr.Domain's Verse.bookNumbers, used for
// cross-translation/cross-player matching — see
// docs/SCRUM/Feature.RequestToStartMPGame.md) is derived from this list's
// distinct-book count and first-encounter order, so one phantom extra book
// shifts every later book's number by one. That's exactly how a
// multiplayer round ended up referencing an impossible verse ("Markus
// 25:38" — the real Markus/Mark has only 16 chapters): "book 42" in the
// corrupted 67-book numbering resolved to Markus instead of its true
// position, 41.

open System
open System.IO
open Xunit
open BibleGuessr.Domain
open BibleGuessr.Api.BibelenDkLoader

let private verse book chapter verseNumber =
    Verse.create book chapter verseNumber "text" "Test Translation"

[<Fact>]
let ``normalizeBookNames merges a period-suffixed spelling into its unsuffixed twin`` () =
    let verses =
        [ verse "Jeremias" 1 1
          verse "Jeremias" 28 1
          verse "Jeremias." 29 1 // the actual real-world artifact
          verse "Jeremias" 30 1 ]

    let normalized = normalizeBookNames verses

    Assert.All(normalized, fun v -> Assert.Equal("Jeremias", v.Book))

[<Fact>]
let ``normalizeBookNames does not merge a book that is consistently spelled with a period`` () =
    // "Matt." (Matthew) is a legitimate, consistently-used abbreviation in
    // the real source — there's no unpunctuated "Matt" anywhere to merge
    // into, so it must be left exactly as-is.
    let verses = [ verse "Matt." 1 1; verse "Matt." 2 1 ]

    let normalized = normalizeBookNames verses

    Assert.All(normalized, fun v -> Assert.Equal("Matt.", v.Book))

[<Fact>]
let ``normalizeBookNames leaves already-consistent book names untouched`` () =
    let verses = [ verse "Genesis" 1 1; verse "Exodus" 1 1 ]

    let normalized = normalizeBookNames verses

    Assert.Equal<Verse list>(verses, normalized)

[<Fact>]
let ``normalizeBookNames collapses the fixed data down to exactly one book per name`` () =
    let verses =
        [ verse "Jeremias" 1 1
          verse "Jeremias." 29 1
          verse "Jeremias" 30 1
          verse "Jeremias." 46 1
          verse "Jeremias." 48 1 ]

    let normalized = normalizeBookNames verses
    let distinctBooks = normalized |> List.map (fun v -> v.Book) |> List.distinct

    Assert.Equal<string list>([ "Jeremias" ], distinctBooks)

[<Fact>]
let ``the real bibelen-dk data set has exactly 66 distinct books after normalization`` () =
    // Exercises the actual shipped data — see
    // bibles/bibelen-dk/src/Bibelen Files.zip — rather than a synthetic
    // sample, so a regression in the real archive (a NEW inconsistent
    // spelling, or this fix silently stopping working) is caught here,
    // not just against the synthetic cases above. The archive is tracked
    // in git, so TestPaths fails loudly if it's missing.
    let verses = loadFromZip TestPaths.bibelenDkArchive
    let distinctBooks = verses |> List.map (fun v -> v.Book) |> List.distinct

    Assert.Equal(66, distinctBooks.Length)

// A minimal chapter page in the shape parseChapterFile documents: an <h1>
// title and a <pre> block of numbered verses, one wrapped across lines.
let private chapterHtml =
    """<html><body><h1>Genesis 1</h1>
<pre>
  1.  I Begyndelsen skabte Gud
      Himmelen og Jorden.
  2.  Og Jorden var øde og tom.
</pre></body></html>"""

[<Fact>]
let ``loadFromHtmlDirectory loads the verses of every chapter page in an unpacked folder`` () =
    let directory = Path.Combine(Path.GetTempPath(), $"bibleguessr-loader-{Guid.NewGuid():N}")
    Directory.CreateDirectory(Path.Combine(directory, "nested")) |> ignore

    try
        File.WriteAllText(Path.Combine(directory, "nested", "01_01.html"), chapterHtml)
        // Front matter with no <h1>/<pre> pair is skipped, as in loadFromZip.
        File.WriteAllText(Path.Combine(directory, "0001.html"), "<html><body>Indhold</body></html>")
        File.WriteAllText(Path.Combine(directory, "notes.txt"), chapterHtml)

        let verses = loadFromHtmlDirectory directory

        Assert.Equal<(string * int * int * string) list>(
            [ "Genesis", 1, 1, "I Begyndelsen skabte Gud Himmelen og Jorden."
              "Genesis", 1, 2, "Og Jorden var øde og tom." ],
            verses |> List.map (fun v -> v.Book, v.Chapter, v.VerseNumber, v.Text)
        )
    finally
        Directory.Delete(directory, true)

[<Fact>]
let ``loadFromHtmlDirectory returns no verses for a missing folder`` () =
    let missing = Path.Combine(Path.GetTempPath(), $"bibleguessr-missing-{Guid.NewGuid():N}")

    Assert.Empty(loadFromHtmlDirectory missing)
