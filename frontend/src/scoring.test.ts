import { describe, expect, it } from 'vitest'
import { scoreGuess } from './scoring'
import type { Guess, Verse } from './types'

const verse: Verse = {
  book: 'John',
  chapter: 3,
  verseNumber: 16,
  text: 'For God so loved the world...',
  translation: 'Test Translation',
  reference: 'John 3:16',
}

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
