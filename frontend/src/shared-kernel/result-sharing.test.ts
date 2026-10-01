import { describe, expect, it } from 'vitest'
import type { Verse } from './bible'
import { RESULT_COLUMNS, columnsHeader, composeShareText, resultLine, type SharedRound } from './result-sharing'

const verse: Verse = { book: 'Rut', chapter: 1, verseNumber: 16, text: 'secret text', translation: 'Test', reference: 'Rut 1:16' }

const rounds: SharedRound[] = [
  { kind: 'answered', verse, guess: { book: 'Rut', chapter: 1, verseNumber: 16 }, points: 1110 },
  { kind: 'answered', verse, guess: { book: 'Rut' }, points: 10 },
  { kind: 'skipped', points: 0 },
  { kind: 'answered', verse, guess: { book: 'Ester', chapter: 1, verseNumber: 16 }, points: 0 },
]

describe('resultLine', () => {
  // ✅ (green check) for a part guessed right, ❌ (red cross) otherwise, in
  // the order book, chapter, verse — then that verse's points.
  it('marks which parts were right, then the points', () => {
    expect(rounds.map((round) => resultLine(round))).toEqual(['✅ ✅ ✅ 1110', '✅ ❌ ❌ 10', 'skipped 0', '❌ ❌ ❌ 0'])
  })

  it('goes by which parts were right, not by the points — a given book scores 0 but is still right', () => {
    expect(resultLine({ kind: 'answered', verse, guess: { book: 'Rut', chapter: 1 }, points: 100 })).toBe('✅ ✅ ❌ 100')
  })
})

describe('composeShareText', () => {
  // The link is whatever address the game is served from, so it follows
  // the environment — here as on www.bibleguessr.single.
  const GAME_URL = 'https://www.bibleguessr.single/'
  const text = composeShareText(['BibleGuessr · The Bible', '1120 points'], rounds, '2026-10-01T14:32:09.000Z', GAME_URL)
  const lines = text.split('\n')

  it('puts the heading first, then the column names and a line per verse, in order', () => {
    expect(lines.slice(0, 7)).toEqual([
      'BibleGuessr · The Bible',
      '1120 points',
      RESULT_COLUMNS,
      '✅ ✅ ✅ 1110',
      '✅ ❌ ❌ 10',
      'skipped 0',
      '❌ ❌ ❌ 0',
    ])
  })

  it('says when it was played, in UTC', () => {
    expect(lines).toContain('Played 2026-10-01 14:32 UTC')
  })

  // Every share links to the game.
  it('always ends with the link to BibleGuessr', () => {
    expect(lines.at(-1)).toBe(GAME_URL)
  })

  it('gives away neither the verses nor their text', () => {
    expect(text).not.toContain('Rut')
    expect(text).not.toContain('secret text')
  })
})

// A game type can leave out a part that is given — the book in a Chapters
// game, and the chapter too when only one was picked: it would always be ✅.
describe('leaving out given parts', () => {
  const answered: SharedRound = { kind: 'answered', verse, guess: { book: 'Rut', chapter: 1, verseNumber: 15 }, points: 100 }

  it('heads and marks only the columns asked for', () => {
    expect(columnsHeader(['chapter', 'verseNumber'])).toBe('Chapter · Verse')
    expect(resultLine(answered, ['chapter', 'verseNumber'])).toBe('✅ ❌ 100')
    expect(columnsHeader(['verseNumber'])).toBe('Verse')
    expect(resultLine(answered, ['verseNumber'])).toBe('❌ 100')
  })

  it('carries the columns through the whole text', () => {
    const lines = composeShareText(['BibleGuessr · Chapters', '100 points'], [answered], '2026-10-01T09:35:00Z', 'https://x/', [
      'chapter',
      'verseNumber',
    ]).split('\n')
    expect(lines.slice(2, 4)).toEqual(['Chapter · Verse', '✅ ❌ 100'])
  })

  it('keeps all three columns by default', () => {
    expect(RESULT_COLUMNS).toBe('Book · Chapter · Verse')
    expect(resultLine(answered)).toBe('✅ ✅ ❌ 100')
  })
})

