import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseChapterEntry } from './epub-parser'

// See docs/SCRUM/BUGS/Bug.VerseTextMissingSpaces.md. Placeholder text only —
// never real text from an uploaded translation (see NOTICE.md).

// parseChapterEntry decodes entities through the DOM (see epub-parser.ts's
// decodeEntities), and vitest runs in the node environment. These fixtures
// contain no entities, so a textarea that hands its markup straight back
// is all they need.
beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => {
      let markup = ''
      return {
        set innerHTML(html: string) {
          markup = html
        },
        get value() {
          return markup
        },
      }
    },
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

/** Chapter 2 of a book, with verse 1 and then verse 2 whose markup is
 * `verse2` — the shape of a JW Library EPUB chapter page. */
function chapterPage(verse2: string): string {
  return [
    '<p class="w_navigation w_biblebookname"><a href="biblebooknav.xhtml">Book</a>',
    '<a href="biblechapternav2.xhtml">2</a> : <a href="bibleversenav2_1.xhtml">1 - 2</a></p>',
    '<p><span id="chapter2_verse1"></span><span class="w_ch"><strong>2</strong></span> Earlier verse.</p>',
    `<p><span id="chapter2_verse2"></span><strong><sup>2</sup></strong> ${verse2}`,
    '<div class="groupFootnote"></div>',
  ].join('\n')
}

function secondVerseText(verse2: string): string {
  return parseChapterEntry(chapterPage(verse2), 'Test Translation')[1].text
}

describe('parseChapterEntry verse text', () => {
  it('shows paragraphs on the same source row as one space apart', () => {
    expect(secondVerseText('Intro:</p>\n<p class="p21 sz">"First line</p><p class="p21 sz">Second line.</p>')).toBe(
      'Intro: "First line Second line.',
    )
  })

  it('shows a line break inside a verse as one space', () => {
    expect(secondVerseText('first line<br/>second line<br />third line<br>fourth line</p>')).toBe(
      'first line second line third line fourth line',
    )
  })

  it('adds no space for inline markup inside a word or before punctuation', () => {
    expect(secondVerseText('one wo<em>rd</em><span class="x">, then</span> <strong>more</strong>.</p>')).toBe(
      'one word, then more.',
    )
  })

  it('keeps the book, chapter and verse numbers', () => {
    const verses = parseChapterEntry(chapterPage('Text.</p>'), 'Test Translation')
    expect(verses.map((verse) => verse.reference)).toEqual(['Book 2:1', 'Book 2:2'])
    expect(verses[0].text).toBe('Earlier verse.')
  })
})
