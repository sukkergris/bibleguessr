import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseRtfZip } from './rtf-parser'

function makeBookRtf(bookName: string, chapterCount: number): string {
  // Minimal shape matching rtf-parser.ts's regexes — just enough to
  // exercise book-name/chapter/verse extraction, not real scripture text.
  let rtf = String.raw`{\rtf1{\f0\fs36\cf1\b ${bookName}\par}`
  for (let ch = 1; ch <= chapterCount; ch++) {
    if (chapterCount > 1) {
      rtf += String.raw`{\f0\fs24\cf1\b Kapitel }{\f1\fs24\cf1\b ${ch}\par}`
    }
    for (let v = 1; v <= 2; v++) {
      rtf += String.raw`{\f1\cf1 ${v}}{\f2\cf1 Verse text ${bookName} ${ch}:${v}}`
    }
  }
  rtf += '}'
  return rtf
}

function zip(files: Record<string, string>): ArrayBuffer {
  const encoded = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, new TextEncoder().encode(content)]),
  )
  const bytes = zipSync(encoded)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('parseRtfZip', () => {
  it('orders books by filename, not by zip entry insertion order (see Feature.BooksGameSorting.md)', async () => {
    // Deliberately scrambled insertion order — this is the whole point:
    // Object.entries() on the unzipped result would otherwise reflect
    // whatever order fflate happened to enumerate entries in, not any
    // Bible-meaningful order. Filenames carry the real book-order prefix
    // ("Bible Online Download" RTF exports name books nwt_01_..,
    // nwt_02_.., etc.), so sorting by filename recovers Bible order
    // regardless of how the zip itself is laid out.
    const buffer = zip({
      'nwt_66_Re_D.rtf': makeBookRtf('Revelation', 1),
      'nwt_01_Ge_D.rtf': makeBookRtf('Genesis', 2),
      'nwt_43_Joh_D.rtf': makeBookRtf('John', 1),
      'nwt_02_Ex_D.rtf': makeBookRtf('Exodus', 1),
    })

    const verses = await parseRtfZip(buffer, 'Test Translation')

    // First-encounter book order in the parsed output should match the
    // filenames' numeric prefixes (1, 2, 43, 66), not the scrambled
    // insertion order above (66, 1, 43, 2).
    const bookOrder = [...new Set(verses.map((v) => v.book))]
    expect(bookOrder).toEqual(['Genesis', 'Exodus', 'John', 'Revelation'])
  })

  it('still parses every book correctly after reordering', async () => {
    const buffer = zip({
      'nwt_66_Re_D.rtf': makeBookRtf('Revelation', 1),
      'nwt_01_Ge_D.rtf': makeBookRtf('Genesis', 2),
    })

    const verses = await parseRtfZip(buffer, 'Test Translation')

    expect(verses.filter((v) => v.book === 'Genesis')).toHaveLength(4) // 2 chapters x 2 verses
    expect(verses.filter((v) => v.book === 'Revelation')).toHaveLength(2) // 1 chapter x 2 verses
  })
})
