/// Loads verse data from the bibelen-dk source: one HTML file per chapter,
/// under `bibles/bibelen-dk/Bibelen Files/`. That folder is gitignored (private
/// local translation data) — this loader reads it at startup if present.
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
open System.Text.RegularExpressions
open BibleGuessr.Domain

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

/// Loads all verses from every chapter file under `directory`.
/// Files that don't parse as a chapter page (no <h1>/<pre>) are skipped.
let loadFromDirectory (directory: string) : Verse list =
    if not (Directory.Exists directory) then
        []
    else
        Directory.GetFiles(directory, "*.html")
        |> Array.toList
        |> List.collect (fun path ->
            let html = File.ReadAllText(path)

            match parseChapterFile (Path.GetFileName path) html with
            | Some verses -> verses
            | None -> [])
