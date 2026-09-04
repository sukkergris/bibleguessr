// Parses a "Bible Online Download" RTF export into Verse[], entirely
// client-side — an alternative source to epub-parser.ts's EPUB support,
// for the same reason: some translations (e.g. NWT) can't be loaded and
// served from the backend for licensing reasons, so the player supplies
// their own file and it's parsed and kept in their own browser, never
// uploaded anywhere.
//
// This export is a plain zip archive of one RTF file per Bible book, named
// like `nwt_01_Ge_D.rtf` (also containing a handful of `nwt_volume_*.rtf`
// front-matter/appendix files with no chapter/verse markup — these parse
// to zero verses and are skipped, same as a non-chapter page in the EPUB
// source).
//
// Each book's RTF has this shape (RTF control words/groups elided):
//   {...\f0\fs36\cf1\b {BookName}\par}                      <!-- book title -->
//   ...
//   {...\f0\fsNN\cfN\b Kapitel }{...\f1\fsNN\cfN\b {N}\par}  <!-- chapter heading -->
//   ...                                                       (or "Salme" for Psalms)
//   {...\f1\cfN {Num}}{...\f2\cfN {verse text, across several
//     RTF groups, with inline \uNNNN? Unicode escapes}}...
//   ...
// A book with only one chapter (e.g. Obadiah, Philemon) has no chapter
// heading at all — every verse marker in the file belongs to chapter 1.
//
// Verse-number markers are recognized by font f1 specifically (f2 is body
// text) — this matches the same "verse number is a distinctly-styled label,
// not part of the text" idea as the EPUB source's drop-cap/superscript
// span, just via RTF font selectors instead of HTML classes.
//
// Known data-quality limitation (inherited from the export itself, not
// introduced by this parser): a small number of verses across the whole
// Bible have their verse-number marker mis-exported in the wrong font or
// with a corrupted digit (e.g. Judges 17:2 renders in the body-text font
// instead of the verse-number font, so it's absorbed into verse 1's text
// and verse 3 immediately follows verse 1). This affects roughly 5 out of
// ~1,180 chapters — left as-is rather than guessed at.
//
// Bump PARSER_VERSION in verse-cache.ts if these regexes change, so any
// cached parse gets invalidated.
import { unzip } from 'fflate'
import type { Verse } from './types'

// A book-name/heading "token": either a plain character (not a backslash or
// brace, which would end the RTF group) or a `\uNNNN?` Unicode escape —
// book names routinely contain one (e.g. "Første Samuelsbog"'s "ø").
const nameToken = String.raw`(?:\\u-?\d+\?|[^\\{}])`

const bookNameRegex = new RegExp(String.raw`\\f0\\fs36\\cf1\\b (${nameToken}+?)\\par\}`)

// "Kapitel" for most books, "Salme" for Psalms — same heading shape either
// way: a label in one font/size, the chapter number in a following group.
const chapterHeadingRegex =
  /\\f0\\fs\d+\\cf\d+\\b (?:Kapitel|Salme) \}\{[^}]*\\f1\\fs\d+\\cf\d+\\b (\d+)\\par\}/g

const verseMarkerRegex = /\\f1\\cf\d+ (\d+)\}/g

const unicodeEscapeRegex = /\\u(-?\d+)\?/g

function decodeUnicodeEscapes(text: string): string {
  return text.replace(unicodeEscapeRegex, (_, code: string) => String.fromCharCode(Number(code) & 0xffff))
}

// Strips RTF control words (\wordNN, optionally followed by one space that's
// part of the control word's own syntax, not text) and the group braces
// around them — what's left is the plain text content.
const controlWordRegex = /\\[a-zA-Z]+-?\d*[ ]?/g

function stripControlWords(text: string): string {
  return text.replace(controlWordRegex, '').replace(/[{}]/g, '')
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function cleanText(raw: string): string {
  return collapseWhitespace(stripControlWords(decodeUnicodeEscapes(raw)))
}

function makeVerse(book: string, chapter: number, verseNumber: number, text: string, translation: string): Verse {
  return { book, chapter, verseNumber, text, translation, reference: `${book} ${chapter}:${verseNumber}` }
}

/**
 * Parses a single book's RTF content into verses. Returns an empty array if
 * the file doesn't look like a Bible book (no book-name heading found) —
 * this is how the export's non-book `nwt_volume_*.rtf` front-matter files
 * are skipped, mirroring epub-parser.ts's "no nav header" case.
 */
export function parseBookEntry(rtf: string, translation: string): Verse[] {
  const bookMatch = bookNameRegex.exec(rtf)
  if (!bookMatch) return []

  const book = cleanText(bookMatch[1])

  const chapterMarkers = [...rtf.matchAll(chapterHeadingRegex)].map((m) => ({
    chapter: Number(m[1]),
    start: m.index,
    end: m.index + m[0].length,
  }))

  // A single-chapter book (e.g. Obadiah, Philemon) has no "Kapitel"/"Salme"
  // heading at all — treat every verse marker after the book title as
  // belonging to chapter 1.
  const chapters =
    chapterMarkers.length > 0 ? chapterMarkers : [{ chapter: 1, start: bookMatch.index + bookMatch[0].length, end: bookMatch.index + bookMatch[0].length }]

  const verseMarkers = [...rtf.matchAll(verseMarkerRegex)].map((m) => ({
    verseNumber: Number(m[1]),
    start: m.index,
    end: m.index + m[0].length,
  }))

  const verses: Verse[] = []

  chapters.forEach((ch, i) => {
    const nextChapterStart = i + 1 < chapters.length ? chapters[i + 1].start : rtf.length
    const versesInChapter = verseMarkers.filter((v) => v.start >= ch.end && v.start < nextChapterStart)

    versesInChapter.forEach((v, j) => {
      const textStart = v.end
      const textEnd = j + 1 < versesInChapter.length ? versesInChapter[j + 1].start : nextChapterStart
      const text = cleanText(rtf.slice(textStart, textEnd))

      verses.push(makeVerse(book, ch.chapter, v.verseNumber, text, translation))
    })
  })

  return verses
}

export interface ParseProgress {
  processed: number
  total: number
}

const CHUNK_SIZE = 5

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Parses a "Bible Online Download" RTF zip (as a File the player picked, or
 * a raw ArrayBuffer) into a flat Verse[].
 *
 * Non-blocking: processes book files in small batches, yielding to the main
 * thread between them — each book file is much larger than an EPUB chapter
 * fragment (tens to low hundreds of KB, vs. a few KB), so the batch size is
 * smaller than epub-parser.ts's to keep individual slices similarly short.
 *
 * translation labels the parsed verses (there's no equivalent of a
 * hardcoded translation label for an arbitrary user file) — pass a display
 * name derived from the filename.
 */
export async function parseRtfZip(
  file: File | ArrayBuffer,
  translation: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<Verse[]> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()

  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      { filter: (entry) => entry.name.endsWith('.rtf') },
      (err, unzipped) => (err ? reject(err) : resolve(unzipped)),
    )
  })

  // Sorted by filename before parsing — the export names each book file
  // with a zero-padded book-order prefix (e.g. "nwt_01_Ge_D.rtf" for
  // Genesis, "nwt_66_Re_D.rtf" for Revelation), which is what makes
  // getBooksInBibleOrder's first-encounter ordering (see local-verses.ts,
  // docs/SCRUM/Feature.BooksGameSorting.md) actually match Bible order —
  // Object.entries()'s own key order otherwise reflects whatever order
  // fflate's unzip happened to enumerate the archive in, which is not
  // guaranteed to be Bible order at all.
  const bookFiles = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))
  const decoder = new TextDecoder('utf-8')
  const verses: Verse[] = []

  for (let i = 0; i < bookFiles.length; i += CHUNK_SIZE) {
    const batch = bookFiles.slice(i, i + CHUNK_SIZE)
    for (const [, bytes] of batch) {
      const rtf = decoder.decode(bytes)
      verses.push(...parseBookEntry(rtf, translation))
    }

    onProgress?.({ processed: Math.min(i + CHUNK_SIZE, bookFiles.length), total: bookFiles.length })
    await yieldToMainThread()
  }

  return verses
}
