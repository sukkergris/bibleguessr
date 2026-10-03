import { describe, expect, it } from 'vitest'
import type { Guess, Verse } from './bible'
import { STANDARD_TIERS, correctParts, maxTieredPoints, tieredPoints } from './scoring'

const verse: Verse = {
  book: 'John',
  chapter: 3,
  verseNumber: 16,
  text: 'For God so loved the world...',
  translation: 'Test Translation',
  reference: 'John 3:16',
}

// The building blocks with the standard tiers — what The Bible scores
// with. Each game type's own rule is in scoring-scenarios/ at the repo
// root (see ../game-types/scoring-scenarios.test.ts).
const scoreGuess = (verse: Verse, guess: Guess) => tieredPoints(verse, guess, STANDARD_TIERS)

function makeGuess(book: string, chapter?: number, verseNumber?: number): Guess {
  return { book, chapter, verseNumber }
}

describe('scoreGuess', () => {
  it('scores 0 for the wrong book', () => {
    expect(scoreGuess(verse, makeGuess('Genesis', 3, 16))).toBe(0)
  })

  it('scores book points only for the right book but wrong chapter', () => {
    expect(scoreGuess(verse, makeGuess('John', 4, 16))).toBe(10)
  })

  it('scores book points only when no chapter was guessed', () => {
    expect(scoreGuess(verse, makeGuess('John'))).toBe(10)
  })

  it('scores book + chapter points for the right book/chapter but wrong verse number', () => {
    expect(scoreGuess(verse, makeGuess('John', 3, 1))).toBe(110)
  })

  it('scores book + chapter points when no verse number was guessed', () => {
    expect(scoreGuess(verse, makeGuess('John', 3))).toBe(110)
  })

  it('scores the full total when book, chapter, and verse number are all correct', () => {
    expect(scoreGuess(verse, makeGuess('John', 3, 16))).toBe(1110)
  })

  it('matches the book case-insensitively', () => {
    expect(scoreGuess(verse, makeGuess('jOHN', 3, 16))).toBe(1110)
  })

  it('trims surrounding whitespace on both sides before comparing', () => {
    expect(scoreGuess(verse, makeGuess('  John  ', 3, 16))).toBe(1110)
  })
})

describe('correctParts', () => {
  const guess = (book: string, chapter?: number, verseNumber?: number): Guess => ({ book, chapter, verseNumber })

  it('marks each part right only when every part before it is right too', () => {
    expect(correctParts(verse, guess('John', 3, 16))).toEqual({ book: true, chapter: true, verseNumber: true })
    expect(correctParts(verse, guess('John', 3, 17))).toEqual({ book: true, chapter: true, verseNumber: false })
    expect(correctParts(verse, guess('John', 4, 16))).toEqual({ book: true, chapter: false, verseNumber: false })
    // The right numbers in the wrong book count for nothing.
    expect(correctParts(verse, guess('Mark', 3, 16))).toEqual({ book: false, chapter: false, verseNumber: false })
  })

  it('counts a part that wasn’t guessed as not right', () => {
    expect(correctParts(verse, guess('John'))).toEqual({ book: true, chapter: false, verseNumber: false })
  })
})


describe('maxTieredPoints', () => {
  it('is every tier together — what a perfect guess earns', () => {
    expect(maxTieredPoints(STANDARD_TIERS)).toBe(1110)
    expect(maxTieredPoints({ ...STANDARD_TIERS, book: 0 })).toBe(1100)
    expect(scoreGuess(verse, makeGuess('John', 3, 16))).toBe(maxTieredPoints(STANDARD_TIERS))
  })
})
