import { describe, expect, it } from 'vitest'
import { chapters } from './chapters'

const RUT_1_16 = {
  book: 'Rut',
  chapter: 1,
  verseNumber: 16,
  text: 'not used',
  translation: 'Test',
  reference: 'Rut 1:16',
}

const GENESIS_TO_LEVITICUS = ['Genesis', 'Exodus', 'Leviticus']

describe('chapters', () => {
  it('needs a book and chapters picked before a game can start', () => {
    expect(chapters.defaultSelection).toBeUndefined()
  })

  it('draws from the picked chapters and fixes the guessed book', () => {
    const selection = { book: 'Exodus', chapters: [1, 2] }
    expect(chapters.verseRestriction(selection)).toEqual({ books: ['Exodus'], chaptersByBook: { Exodus: [1, 2] } })
    expect(chapters.guessConstraint(selection)).toEqual({ kind: 'fixed-book', book: 'Exodus', chapters: [1, 2] })
  })

  describe('toWire', () => {
    it('sends the book as its number with its chapters', () => {
      expect(chapters.toWire({ book: 'Exodus', chapters: [1, 2] }, GENESIS_TO_LEVITICUS)).toEqual({
        Case: 'Chapters',
        Fields: [{ 2: [1, 2] }],
      })
    })

    it('sends no book when the sender’s source does not have it', () => {
      expect(chapters.toWire({ book: 'Tobit', chapters: [1] }, GENESIS_TO_LEVITICUS)).toEqual({
        Case: 'Chapters',
        Fields: [{}],
      })
    })
  })

  describe('describeWire', () => {
    it('lists sorted chapters per book in the viewer’s own spelling', () => {
      expect(chapters.describeWire({ Case: 'Chapters', Fields: [{ 1: [3, 1, 2] }] }, GENESIS_TO_LEVITICUS)).toBe(
        'Chapters: Genesis 1, 2, 3',
      )
    })

    it('shows a book the viewer’s source lacks as "Book N"', () => {
      expect(chapters.describeWire({ Case: 'Chapters', Fields: [{ 9: [1] }] }, GENESIS_TO_LEVITICUS)).toBe(
        'Chapters: Book 9 1',
      )
    })

    it('selects nothing when no book is listed', () => {
      expect(chapters.describeWire({ Case: 'Chapters', Fields: [{}] }, GENESIS_TO_LEVITICUS)).toBeUndefined()
    })
  })

  describe('guessConstraintForWire', () => {
    it('fixes the book in the viewer’s own spelling and offers its chapters', () => {
      expect(chapters.guessConstraintForWire({ Case: 'Chapters', Fields: [{ 2: [1, 2] }] }, GENESIS_TO_LEVITICUS)).toEqual(
        { kind: 'fixed-book', book: 'Exodus', chapters: [1, 2] },
      )
    })

    it('offers every book when the viewer’s source lacks the fixed one', () => {
      expect(chapters.guessConstraintForWire({ Case: 'Chapters', Fields: [{ 9: [1] }] }, GENESIS_TO_LEVITICUS)).toEqual({
        kind: 'any-book',
      })
    })

    it('offers every book when no book is listed', () => {
      expect(chapters.guessConstraintForWire({ Case: 'Chapters', Fields: [{}] }, GENESIS_TO_LEVITICUS)).toEqual({
        kind: 'any-book',
      })
    })
  })

  // The book is fixed at setup, so it's a given, not an achievement: it
  // earns nothing on its own. Chapter and verse keep the standard tiers.
  it('gives no points for the book, which is given', () => {
    const score = (guess: { book: string; chapter?: number; verseNumber?: number }) =>
      chapters.scoreGuess({ book: 'Rut', chapters: [1, 2] }, RUT_1_16, guess)
    expect(score({ book: 'Rut' })).toBe(0)
    expect(score({ book: 'Rut', chapter: 2 })).toBe(0)
    expect(score({ book: 'Rut', chapter: 1 })).toBe(100)
    expect(score({ book: 'Rut', chapter: 1, verseNumber: 16 })).toBe(1100)
  })

  // With a single chapter picked, the chapter is a given too: only the
  // verse is left to earn points for.
  it('gives no points for the chapter either when only one was picked', () => {
    const score = (guess: { book: string; chapter?: number; verseNumber?: number }) =>
      chapters.scoreGuess({ book: 'Rut', chapters: [1] }, RUT_1_16, guess)
    expect(score({ book: 'Rut' })).toBe(0)
    expect(score({ book: 'Rut', chapter: 1 })).toBe(0)
    expect(score({ book: 'Rut', chapter: 1, verseNumber: 15 })).toBe(0)
    expect(score({ book: 'Rut', chapter: 1, verseNumber: 16 })).toBe(1000)
  })
})
