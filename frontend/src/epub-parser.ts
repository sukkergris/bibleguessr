// Parses a Bible EPUB export into Verse[], entirely client-side — this is
// how the app supports translations (e.g. NWT) that can't be loaded and
// served from the backend for licensing reasons: the player supplies their
// own file, and it's parsed and kept in their own browser, never uploaded
// anywhere.
//
// An EPUB is a plain zip archive; the scripture text lives in its
// OEBPS/*.xhtml entries, one file per chapter, in the markup shape below —
// this is the shape used by the "JW Library" family of EPUB exports. Only
// entries with the Bible-navigation header below are chapter pages —
// everything else (title pages, nav pages, cover, images) is skipped.
//
// Chapter page shape (whitespace/attributes elided):
//   <p class="w_navigation w_biblebookname">
//     <a href="biblebooknav.xhtml">{BookName}</a>
//     <a href="biblechapternavN.xhtml">{ChapterNumber}</a> :   <!-- omitted for single-chapter books -->
//     <a href="bibleversenavX_Y.xhtml">1 - N</a>
//   </p>
//   ...
//   <span id="chapter{Chapter}_verse{Num}"></span>{verse text, possibly
//     spanning multiple <p> tags, with inline footnote markers}...
//   ...
//   <div class="groupFootnote">...</div>   <!-- end of verse text -->
//
// Verse boundaries come from the `chapter{N}_verse{M}` span ids rather than
// the rendered verse number, because verse 1 of a chapter is displayed with
// the *chapter* number as a drop cap (e.g. chapter 65 verse 1 renders "65",
// not "1") — the id is the only place the real verse number is reliable.
//
// Bump PARSER_VERSION in verse-cache.ts if these regexes change, so any
// cached parse gets invalidated.
import { unzip } from 'fflate'
import type { Verse } from './types'

const navHeaderRegex =
  /<p class="w_navigation w_biblebookname"><a href="biblebooknav\.xhtml">(?<book>[^<]*)<\/a>\s*(?:<a href="biblechapternav\d+\.xhtml">(?<chapter>\d+)<\/a>\s*:\s*)?<a href="bibleversenav/

const verseMarkerRegex = /<span id="chapter\d+_verse(?<num>\d+)"><\/span>/g

const footnoteBlockRegex = /<div class="groupFootnote">/

// The rendered verse-number label right after a verse marker: either a
// drop-cap span showing the *chapter* number (verse 1 of every chapter) or
// a plain superscript verse number (every other verse). Neither is part of
// the verse text. Matches only once per verse, mirroring the F# loader's
// `Replace(s, "", 1)`.
const verseNumberLabelRegex =
  /^\s*(?:<span class="w_ch"><strong>\d+<\/strong>\s*<\/span>|<strong><sup>\d+<\/sup><\/strong>)\s*/

// Inline footnote markers: an anchor point plus a "*" link to the footnote
// text at the end of the chapter. Not part of the verse text itself.
const footnoteRefRegex = /<span id="footnotesource\d+"><\/span><a epub:type="noteref"[^>]*>\*<\/a>/g

const stripTagsRegex = /<[^>]+>/g

function stripTags(html: string): string {
  return html.replace(stripTagsRegex, '')
}

// EPUB's package metadata file (OEBPS/content.opf is the JW Library export's
// path for it; opf:package's manifest can in principle place it anywhere,
// but every export this app has been tested against uses this exact path)
// carries the translation's real title and language, e.g.:
//   <dc:title>Ny Verden-Oversættelsen (nwt-D)</dc:title>
//   <dc:language>da</dc:language>
// This is far more useful than the uploaded filename for telling multiple
// cached translations apart, since JW Library / bible export tools tend to
// name every download the same generic thing (e.g. "Bible NWT.epub"
// regardless of language) — the filename alone can't distinguish a Danish
// NWT from an English one.
const titleRegex = /<dc:title[^>]*>([^<]*)<\/dc:title>/
const languageRegex = /<dc:language[^>]*>([^<]*)<\/dc:language>/

/**
 * Reads OEBPS/content.opf's <dc:title>/<dc:language> out of an EPUB, for a
 * display name like "Ny Verden-Oversættelsen (nwt-D) (da)". Returns
 * undefined if the EPUB has no such file or no title (some non-JW EPUB
 * exports may not) — callers should fall back to the filename in that case.
 */
export async function detectEpubTranslationName(file: File): Promise<string | undefined> {
  const buffer = await file.arrayBuffer()

  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(new Uint8Array(buffer), { filter: (entry) => entry.name.endsWith('content.opf') }, (err, unzipped) =>
      err ? reject(err) : resolve(unzipped),
    )
  })

  const opfBytes = Object.values(entries)[0]
  if (!opfBytes) return undefined

  const opfXml = new TextDecoder('utf-8').decode(opfBytes)
  const title = titleRegex.exec(opfXml)?.[1]?.trim()
  const language = languageRegex.exec(opfXml)?.[1]?.trim()

  if (!title) return undefined
  return language ? `${title} (${language})` : title
}

// The browser has no built-in equivalent of .NET's WebUtility.HtmlDecode
// other than round-tripping through the DOM — cheap for the short,
// per-verse strings this is called on.
function decodeEntities(text: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function makeVerse(book: string, chapter: number, verseNumber: number, text: string, translation: string): Verse {
  return { book, chapter, verseNumber, text, translation, reference: `${book} ${chapter}:${verseNumber}` }
}

/**
 * Parses a single chapter entry's XHTML into verses. Returns an empty array
 * if the entry doesn't look like a chapter page (nav pages, title pages,
 * empty "extracted" study-note containers) — recognized by having no
 * Bible-navigation header, mirroring the F# loader's `None` case.
 */
export function parseChapterEntry(html: string, translation: string): Verse[] {
  const navMatch = navHeaderRegex.exec(html)
  if (!navMatch?.groups) return []

  // The source markup uses a non-breaking space in some book names (e.g.
  // "1. Johannes", to keep the numeral glued to the name) — collapseWhitespace
  // normalizes it to a regular space so guesses typed with an ordinary space
  // still match.
  const book = collapseWhitespace(navMatch.groups.book)
  const chapter = navMatch.groups.chapter ? Number(navMatch.groups.chapter) : 1

  // Verse text runs until the next verse marker, or — for the last verse —
  // until the footnote block (or end of document, if there are no footnotes).
  const footnoteMatch = footnoteBlockRegex.exec(html)
  const contentEnd = footnoteMatch ? footnoteMatch.index : html.length

  const markers = [...html.matchAll(verseMarkerRegex)]

  return markers.map((m, i) => {
    const textStart = m.index + m[0].length
    const textEnd = i + 1 < markers.length ? markers[i + 1].index : contentEnd
    const rawText = html.slice(textStart, textEnd)

    const text = collapseWhitespace(
      decodeEntities(
        stripTags(rawText.replace(verseNumberLabelRegex, '').replace(footnoteRefRegex, '')),
      ),
    )

    return makeVerse(book, chapter, Number(m.groups!.num), text, translation)
  })
}

export interface ParseProgress {
  processed: number
  total: number
}

const CHUNK_SIZE = 50

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
 * Parses a Bible EPUB (as a File the player picked, or a raw ArrayBuffer —
 * e.g. when re-parsing isn't needed because a cache already has the result,
 * an ArrayBuffer form isn't used by this app today, but the signature keeps
 * that door open) into a flat Verse[].
 *
 * Non-blocking: processes chapter entries in small batches, yielding to the
 * main thread between them so a multi-MB EPUB doesn't freeze the page.
 *
 * translation labels the parsed verses (there's no equivalent of the
 * backend's hardcoded TranslationLabel for an arbitrary user file) — pass
 * a display name derived from the filename.
 */
export async function parseEpub(
  file: File | ArrayBuffer,
  translation: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<Verse[]> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()

  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      // Only .xhtml entries hold scripture text — skip decompressing
      // everything else (images are the bulk of the archive by size).
      { filter: (entry) => entry.name.endsWith('.xhtml') },
      (err, unzipped) => (err ? reject(err) : resolve(unzipped)),
    )
  })

  const chapterFiles = Object.entries(entries)
  const decoder = new TextDecoder('utf-8')
  const verses: Verse[] = []

  for (let i = 0; i < chapterFiles.length; i += CHUNK_SIZE) {
    const batch = chapterFiles.slice(i, i + CHUNK_SIZE)
    for (const [, bytes] of batch) {
      const html = decoder.decode(bytes)
      verses.push(...parseChapterEntry(html, translation))
    }

    onProgress?.({ processed: Math.min(i + CHUNK_SIZE, chapterFiles.length), total: chapterFiles.length })
    await yieldToMainThread()
  }

  return verses
}
