/// Loads verse data from the bibelen-dk source: one HTML file per chapter,
/// zipped into a single archive under `bibles/bibelen-dk/src/`. That
/// translation is public domain, so its source files are tracked in git —
/// only unpacked copies are gitignored. At startup, BibleArchiveUnpacker
/// unpacks the archive into a data folder, and `loadFromHtmlDirectory`
/// reads it from there; `loadFromZip` reads the archive directly.
///
/// File shape:
///   <h1>{BookName}[ {ChapterNumber}]</h1>
///   <pre>
///     1.  Verse text, possibly wrapped
///         across multiple lines...
///     2.  Next verse...
///   </pre>
///
/// The chapter number is omitted from the title for single-chapter books
/// (defaults to 1). Filenames themselves are not parsed for book/chapter —
/// the trailing hex-looking chapter suffix (e.g. `19_96.html` for Psalm 150)
/// does not reliably decode to the real chapter number, so the `<h1>` text
/// is the source of truth instead.
module BibleGuessr.Api.BibelenDkLoader

open System
open System.IO
open System.IO.Compression
open System.Text.RegularExpressions
open BibleGuessr.Domain

/// The folder the archive is unpacked into under the data directory.
[<Literal>]
let TranslationFolder = "bibelen-dk"

[<Literal>]
let TranslationLabel = "bibelen-dk (1931/1907, offentligt tilgængelig)"

let private titleRegex = Regex(@"<h1>(?<book>.*?)(?:\s+(?<chapter>\d+))?</h1>", RegexOptions.Compiled)
let private preBlockRegex = Regex(@"<pre>(?<body>.*?)</pre>", RegexOptions.Compiled ||| RegexOptions.Singleline)

// Verse markers look like "  1.  " or " 12.  " at the start of a line, with
// text continuing (indented) on following lines until the next marker.
let private verseMarkerRegex = Regex(@"(?m)^\s*(?<num>\d+)\.\s+", RegexOptions.Compiled)

let private stripTags (html: string) =
    Regex.Replace(html, "<[^>]+>", "")

let private decodeEntities (text: string) = System.Net.WebUtility.HtmlDecode(text)

let private collapseWhitespace (text: string) =
    Regex.Replace(text, @"\s+", " ").Trim()

/// Parses a single chapter HTML file's content into verses.
/// Returns None if the file doesn't look like a chapter page (e.g. index.html,
/// front-matter pages) — recognized by having no <h1>/<pre> pair.
let parseChapterFile (fileName: string) (html: string) : Verse list option =
    let titleMatch = titleRegex.Match(html)
    let preMatch = preBlockRegex.Match(html)

    if not titleMatch.Success || not preMatch.Success then
        None
    else
        let book = titleMatch.Groups["book"].Value.Trim()

        let chapter =
            if titleMatch.Groups["chapter"].Success then
                int titleMatch.Groups["chapter"].Value
            else
                1

        let body = preMatch.Groups["body"].Value
        let markers = verseMarkerRegex.Matches(body) |> Seq.cast<Match> |> List.ofSeq

        markers
        |> List.mapi (fun i m ->
            let textStart = m.Index + m.Length
            let textEnd =
                if i + 1 < markers.Length then
                    markers[i + 1].Index
                else
                    body.Length

            let rawText = body.Substring(textStart, textEnd - textStart)
            let text = rawText |> stripTags |> decodeEntities |> collapseWhitespace

            Verse.create book chapter (int m.Groups["num"].Value) text TranslationLabel)
        |> Some

/// Fixes a data-quality artifact found in the scraped source: a handful of
/// chapter files title their book with a stray trailing period (e.g.
/// "Jeremias." on Jeremiah 29/46/48) where every other chapter of the same
/// book has none ("Jeremias") — the `<h1>` text is taken verbatim as the
/// book name (see parseChapterFile), so without this fix those few
/// chapters silently become a DIFFERENT, 67th "book" from the other 51571
/// chapters of Jeremiah. That matters well beyond cosmetics: every book
/// number downstream of the split is derived from this list's distinct
/// book count and first-encounter order (see Verse.bookNumbers in
/// BibleGuessr.Domain) for cross-translation/cross-file matching (see
/// docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation
/// note) — one extra phantom book here shifts every later book's number
/// by one, which is what let a multiplayer round reference an impossible
/// chapter/verse (e.g. "Markus 25:38" — the real Markus has 16 chapters).
///
/// Deliberately NOT a blanket "strip every trailing period" — some book
/// names are LEGITIMATELY abbreviated with one (e.g. "Matt." for Matthew,
/// used consistently on every one of its chapters) and must stay as-is.
/// Only merges a period-suffixed spelling into its un-suffixed twin when
/// that twin is ALSO present in `verses` — i.e. only fixes an inconsistency
/// between two spellings of what's otherwise the same book, never
/// "corrects" a book that's consistently spelled with a period everywhere.
let normalizeBookNames (verses: Verse list) : Verse list =
    let bookNames = verses |> List.map (fun v -> v.Book) |> Set.ofList

    let normalize (book: string) =
        if book.EndsWith(".") && bookNames.Contains(book.TrimEnd('.')) then
            book.TrimEnd('.')
        else
            book

    verses |> List.map (fun v -> { v with Book = normalize v.Book })

/// Parses (file name, HTML) pairs into verses. Pages that don't parse as a
/// chapter page (no <h1>/<pre>) are skipped.
let private parseHtmlPages (pages: (string * string) seq) : Verse list =
    pages
    |> Seq.toList
    |> List.collect (fun (name, html) ->
        match parseChapterFile name html with
        | Some verses -> verses
        | None -> [])
    |> normalizeBookNames

/// Loads all verses from every `*.html` entry in the zip archive at
/// `zipPath`.
let loadFromZip (zipPath: string) : Verse list =
    if not (File.Exists zipPath) then
        []
    else
        use archive = ZipFile.OpenRead(zipPath)

        archive.Entries
        |> Seq.filter (fun entry -> entry.Name.EndsWith(".html"))
        |> Seq.map (fun entry ->
            use stream = entry.Open()
            use reader = new StreamReader(stream)
            entry.Name, reader.ReadToEnd())
        |> Seq.toList
        |> parseHtmlPages

/// Loads all verses from every `*.html` file under `directory`, e.g. the
/// folder BibleArchiveUnpacker unpacked the archive into. Files are read
/// in ordinal path order, the same order as the archive's entries, so
/// first-encounter book order (and so book numbers, see
/// Verse.bookNumbers) matches reading the zip directly.
let loadFromHtmlDirectory (directory: string) : Verse list =
    if not (Directory.Exists directory) then
        []
    else
        Directory.GetFiles(directory, "*.html", SearchOption.AllDirectories)
        |> Array.sortWith (fun a b -> String.CompareOrdinal(a, b))
        |> Seq.map (fun path -> Path.GetFileName path, File.ReadAllText path)
        |> parseHtmlPages
