/// Loads verse data from the Jehovah's Witnesses NWT source: a single EPUB
/// file, under `bibles/jw/src/`. That folder is gitignored (private local
/// translation data) — this loader reads it at startup if present.
///
/// An EPUB is a zip archive; the scripture text lives in its `OEBPS/*.xhtml`
/// entries, one file per chapter. Only entries with the Bible-navigation
/// header below are chapter pages — everything else (title pages, book/
/// chapter nav pages, empty "extracted" study-note containers) is skipped.
///
/// Chapter page shape (whitespace/attributes elided):
///   <p class="w_navigation w_biblebookname">
///     <a href="biblebooknav.xhtml">{BookName}</a>
///     <a href="biblechapternavN.xhtml">{ChapterNumber}</a> :   <!-- omitted for single-chapter books -->
///     <a href="bibleversenavX_Y.xhtml">1 - N</a>
///   </p>
///   ...
///   <span id="chapter{Chapter}_verse{Num}"></span>{verse text, possibly
///     spanning multiple <p> tags, with inline footnote markers}...
///   ...
///   <div class="groupFootnote">...</div>   <!-- end of verse text -->
///
/// Verse boundaries come from the `chapter{N}_verse{M}` span ids rather than
/// the rendered verse number, because verse 1 of a chapter is displayed with
/// the *chapter* number as a drop cap (e.g. chapter 65 verse 1 renders "65",
/// not "1") — the id is the only place the real verse number is reliable.
module BibleGuessr.Api.JwEpubLoader

open System.IO
open System.IO.Compression
open System.Text.RegularExpressions
open BibleGuessr.Domain

[<Literal>]
let TranslationLabel = "Ny Verden-Oversættelsen (nwt-D, Jehovas Vidner)"

let private navHeaderRegex =
    Regex(
        @"<p class=""w_navigation w_biblebookname""><a href=""biblebooknav\.xhtml"">(?<book>[^<]*)</a>\s*(?:<a href=""biblechapternav\d+\.xhtml"">(?<chapter>\d+)</a>\s*:\s*)?<a href=""bibleversenav",
        RegexOptions.Compiled
    )

let private verseMarkerRegex =
    Regex(@"<span id=""chapter\d+_verse(?<num>\d+)""></span>", RegexOptions.Compiled)

let private footnoteBlockRegex =
    Regex(@"<div class=""groupFootnote"">", RegexOptions.Compiled)

// The rendered verse-number label right after a verse marker: either a
// drop-cap span showing the *chapter* number (verse 1 of every chapter) or
// a plain superscript verse number (every other verse). Neither is part of
// the verse text.
let private verseNumberLabelRegex =
    Regex(
        @"^\s*(?:<span class=""w_ch""><strong>\d+</strong>\s*</span>|<strong><sup>\d+</sup></strong>)\s*",
        RegexOptions.Compiled
    )

// Inline footnote markers: an anchor point plus a "*" link to the footnote
// text at the end of the chapter. Not part of the verse text itself.
let private footnoteRefRegex =
    Regex(@"<span id=""footnotesource\d+""></span><a epub:type=""noteref""[^>]*>\*</a>", RegexOptions.Compiled)

let private stripTags (html: string) =
    Regex.Replace(html, "<[^>]+>", "")

let private decodeEntities (text: string) = System.Net.WebUtility.HtmlDecode(text)

let private collapseWhitespace (text: string) =
    Regex.Replace(text, @"\s+", " ").Trim()

/// Parses a single chapter entry's content into verses.
/// Returns None if the entry doesn't look like a chapter page (e.g. nav
/// pages, title pages, empty extract containers) — recognized by having no
/// Bible-navigation header.
let parseChapterEntry (entryName: string) (html: string) : Verse list option =
    let navMatch = navHeaderRegex.Match(html)

    if not navMatch.Success then
        None
    else
        // The source markup uses a non-breaking space in some book names
        // (e.g. "1. Johannes", to keep the numeral glued to the name)
        // — collapseWhitespace normalizes it to a regular space so guesses
        // typed with an ordinary space still match.
        let book = navMatch.Groups["book"].Value |> collapseWhitespace

        let chapter =
            if navMatch.Groups["chapter"].Success then
                int navMatch.Groups["chapter"].Value
            else
                1

        // Verse text runs until the next verse marker, or — for the last
        // verse — until the footnote block (or end of document, if there
        // are no footnotes).
        let contentEnd =
            let footnoteMatch = footnoteBlockRegex.Match(html)
            if footnoteMatch.Success then footnoteMatch.Index else html.Length

        let markers = verseMarkerRegex.Matches(html) |> Seq.cast<Match> |> List.ofSeq

        markers
        |> List.mapi (fun i m ->
            let textStart = m.Index + m.Length
            let textEnd =
                if i + 1 < markers.Length then
                    markers[i + 1].Index
                else
                    contentEnd

            let rawText = html.Substring(textStart, textEnd - textStart)

            let text =
                rawText
                |> fun s -> verseNumberLabelRegex.Replace(s, "", 1)
                |> fun s -> footnoteRefRegex.Replace(s, "")
                |> stripTags
                |> decodeEntities
                |> collapseWhitespace

            Verse.create book chapter (int m.Groups["num"].Value) text TranslationLabel)
        |> Some

/// Loads all verses from every chapter entry in the EPUB at `epubPath`.
/// Entries that don't parse as a chapter page are skipped.
let loadFromEpub (epubPath: string) : Verse list =
    if not (File.Exists epubPath) then
        []
    else
        use archive = ZipFile.OpenRead(epubPath)

        archive.Entries
        |> Seq.filter (fun entry -> entry.FullName.EndsWith(".xhtml"))
        |> Seq.toList
        |> List.collect (fun entry ->
            use stream = entry.Open()
            use reader = new StreamReader(stream)
            let html = reader.ReadToEnd()

            match parseChapterEntry entry.FullName html with
            | Some verses -> verses
            | None -> [])

/// Loads all verses from the first `*.epub` file found under `directory`.
let loadFromDirectory (directory: string) : Verse list =
    if not (Directory.Exists directory) then
        []
    else
        Directory.GetFiles(directory, "*.epub")
        |> Array.toList
        |> List.collect loadFromEpub
