/// Loads verse data from the Jehovah's Witnesses NWT source: a set of RTF
/// files, one per book, zipped into a single archive under `bibles/jw/src/`.
/// That folder is gitignored (private local translation data) — this loader
/// reads it at startup if present.
///
/// This is an alternative source for the same translation as JwEpubLoader,
/// exported from a word processor rather than the EPUB reader — the two
/// loaders must never run together, since they name books differently (this
/// loader normalizes book names to match JwEpubLoader's, via BookNames, so
/// picking one over the other doesn't change how guesses match).
///
/// Filenames encode the book's canonical order and abbreviation, e.g.
/// `nwt_23_Isa_D.rtf` is book 23 (Esajas). `nwt_volume_*.rtf` files are
/// front/back matter (indexes, appendixes) with no chapter content and are
/// skipped.
///
/// Each book file's body is, in order:
///   1. An "Oversigt over indholdet" (outline) listing every chapter's
///      summary up front — not scripture text, must be skipped entirely.
///   2. The chapter bodies themselves. A chapter heading looks like
///      (whitespace/attributes elided):
///        {\f0\fs32\cf_ \b Kapitel }{\f1\fs32\cf_ \b {N}\par}
///      (or "Salme" for Psalms). Chapter 1 of a book has no heading — the
///      body starts directly with its verse 1 right after the outline.
///   3. Verses within a chapter are marked:
///        {\f1\cf_ {N}}{\f2\cf_ {verse text, possibly spanning multiple
///        \par-separated lines}}
///      running until the next verse marker (or end of file for the last
///      verse of the last chapter).
///
/// Verse numbers come from the marker's own digits, unlike JwEpubLoader
/// (this format has no "verse 1 rendered as the chapter number" quirk).
///
/// Known limitation: a handful of two-digit verse numbers (~3-4 out of
/// 31,000+ verses, e.g. 1 Kings 12:30, 1 Chronicles 8:35 and 9:41) have
/// their first digit swallowed by the exporter where a verse boundary
/// lands right after a differently-styled run (typically a cross-reference
/// superscript next to a place name) — those verses load with a
/// corrupted single-digit number instead of being fixed up or dropped.
/// JwEpubLoader does not have this issue, if exactness matters more than
/// using this source.
module BibleGuessr.Api.JwRtfLoader

open System.IO
open System.IO.Compression
open System.Text.RegularExpressions
open BibleGuessr.Domain

[<Literal>]
let TranslationLabel = "Ny Verden-Oversættelsen (nwt-D, Jehovas Vidner)"

/// Canonical Bible book names, 1-indexed, matching JwEpubLoader's naming
/// exactly (both ultimately describe the same 66-book NWT translation).
let private bookNames =
    [| "1. Mosebog"; "2. Mosebog"; "3. Mosebog"; "4. Mosebog"; "5. Mosebog"
       "Josva"; "Dommerne"; "Ruth"; "1. Samuel"; "2. Samuel"
       "1. Kongebog"; "2. Kongebog"; "1. Krønikebog"; "2. Krønikebog"; "Ezra"
       "Nehemias"; "Ester"; "Job"; "Salmerne"; "Ordsprogene"
       "Prædikeren"; "Højsangen"; "Esajas"; "Jeremias"; "Klagesangene"
       "Ezekiel"; "Daniel"; "Hoseas"; "Joel"; "Amos"
       "Obadias"; "Jonas"; "Mika"; "Nahum"; "Habakkuk"
       "Sefanias"; "Haggaj"; "Zakarias"; "Malakias"; "Matthæus"
       "Markus"; "Lukas"; "Johannes"; "Apostlenes Gerninger"; "Romerne"
       "1. Korinther"; "2. Korinther"; "Galaterne"; "Efeserne"; "Filipperne"
       "Kolossenserne"; "1. Thessaloniker"; "2. Thessaloniker"; "1. Timotheus"; "2. Timotheus"
       "Titus"; "Filemon"; "Hebræerne"; "Jakob"; "1. Peter"
       "2. Peter"; "1. Johannes"; "2. Johannes"; "3. Johannes"; "Judas"
       "Åbenbaringen" |]

let private fileNameRegex = Regex(@"^nwt_(?<num>\d+)_", RegexOptions.Compiled)

let private chapterHeadingRegex =
    Regex(
        @"\\f0\\fs32\\cf\d+\\b (?:Kapitel|Salme) \}\{[^}]*\\f1\\fs32\\cf\d+\\b (?<num>\d+)\\par\}",
        RegexOptions.Compiled
    )

// Psalms alone is subdivided into five "books" (Første/Anden/Tredje/Fjerde/
// Femte Bog), each introduced by a heading of this shape right before the
// next Psalm's chapter heading. Not scripture text — must be excluded from
// the preceding verse the same way a chapter heading is.
let private psalmsBookDividerRegex =
    Regex(@"\\f2\\cf\d+ (?:Første|Anden|Tredje|Fjerde|Femte) Bog\\par\}", RegexOptions.Compiled)

let private verseMarkerRegex =
    Regex(@"\\f1\\cf\d+ (?<num>\d+)\}\{[^}]*?\\f2\\cf\d+ ", RegexOptions.Compiled)

// RTF's own escape for a Unicode code point: \uNNNN, followed by a single
// fallback character for readers that don't support it (conventionally
// "?") which must be dropped along with the escape itself.
let private unicodeEscapeRegex = Regex(@"\\u(?<code>-?\d+)\?", RegexOptions.Compiled)

// Any other control word (e.g. \par, \pard, \langfe1033) plus the single
// space that often follows it, and the group braces themselves. What's
// left after this is the plain text.
let private controlWordRegex = Regex(@"\\[a-zA-Z]+-?\d*\s?", RegexOptions.Compiled)

let private decodeRtfText (rtf: string) =
    let withUnicode =
        unicodeEscapeRegex.Replace(
            rtf,
            fun m ->
                let code = int m.Groups["code"].Value
                string (char ((code % 65536 + 65536) % 65536))
        )

    let withoutControlWords = controlWordRegex.Replace(withUnicode, " ")

    withoutControlWords.Replace("{", "").Replace("}", "")
    |> fun s -> Regex.Replace(s, @"\s+", " ")
    |> fun s -> s.Trim()

/// Parses one book's RTF content into verses. Returns an empty list if the
/// content doesn't look like a book page (no verse markers at all) — covers
/// the `nwt_volume_*.rtf` front/back-matter files.
let parseBookFile (bookNumber: int) (rtf: string) : Verse list =
    if bookNumber < 1 || bookNumber > bookNames.Length then
        []
    else
        let book = bookNames[bookNumber - 1]

        let headings =
            chapterHeadingRegex.Matches(rtf)
            |> Seq.cast<Match>
            |> Seq.map (fun m -> m.Index, int m.Groups["num"].Value)
            |> List.ofSeq

        // Chapter 1 has no heading of its own (the outline ends and verse 1
        // starts directly), so the chapter for a position before the first
        // heading is implicitly 1.
        let chapterAt (pos: int) =
            headings
            |> List.fold (fun current (hpos, hnum) -> if hpos < pos then hnum else current) 1

        let markers = verseMarkerRegex.Matches(rtf) |> Seq.cast<Match> |> List.ofSeq

        // The last verse of a chapter has no following verse marker to stop
        // at within that chapter — the next token in the file is the next
        // chapter's heading (or, in Psalms, a book-divider right before
        // that heading) — neither of which may be swept into the verse text.
        let nonVerseStopPositions =
            (headings |> List.map fst)
            @ (psalmsBookDividerRegex.Matches(rtf) |> Seq.cast<Match> |> Seq.map (fun m -> m.Index) |> List.ofSeq)
            |> List.sort

        let nextStopAfter (pos: int) =
            nonVerseStopPositions |> List.tryFind (fun stopPos -> stopPos > pos)

        markers
        |> List.mapi (fun i m ->
            let textStart = m.Index + m.Length
            let nextMarkerPos =
                if i + 1 < markers.Length then
                    markers[i + 1].Index
                else
                    rtf.Length

            let textEnd =
                match nextStopAfter m.Index with
                | Some stopPos when stopPos < nextMarkerPos -> stopPos
                | _ -> nextMarkerPos

            let text = rtf.Substring(textStart, textEnd - textStart) |> decodeRtfText
            let chapter = chapterAt m.Index

            Verse.create book chapter (int m.Groups["num"].Value) text TranslationLabel)

/// Loads all verses from every `nwt_*.rtf` entry in the zip archive at
/// `zipPath`. Entries that don't parse as book content (e.g.
/// `nwt_volume_*.rtf` front/back matter) contribute no verses.
let loadFromZip (zipPath: string) : Verse list =
    if not (File.Exists zipPath) then
        []
    else
        use archive = ZipFile.OpenRead(zipPath)

        archive.Entries
        |> Seq.filter (fun entry -> entry.Name.EndsWith(".rtf"))
        |> Seq.toList
        |> List.collect (fun entry ->
            let nameMatch = fileNameRegex.Match(entry.Name)

            if not nameMatch.Success then
                []
            else
                let bookNumber = int nameMatch.Groups["num"].Value
                use stream = entry.Open()
                use reader = new StreamReader(stream)
                let rtf = reader.ReadToEnd()
                parseBookFile bookNumber rtf)

/// Loads all verses from the first `*.zip` file found under `directory`.
let loadFromDirectory (directory: string) : Verse list =
    if not (Directory.Exists directory) then
        []
    else
        Directory.GetFiles(directory, "*.zip")
        |> Array.toList
        |> List.collect loadFromZip
