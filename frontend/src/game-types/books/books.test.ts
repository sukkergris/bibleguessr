import { describe, expect, it } from 'vitest'
import { books } from './books'

const RUT_1_16 = {
  book: 'Rut',
  chapter: 1,
  verseNumber: 16,
  text: 'not used',
  translation: 'Test',
  reference: 'Rut 1:16',
}

const GENESIS_TO_LEVITICUS = ['Genesis', 'Exodus', 'Leviticus']

describe('books', () => {
  it('needs books picked before a game can start', () => {
    expect(books.defaultSelection).toBeUndefined()
  })

  it('draws from, and lets the player guess, only the picked books', () => {
    const selection = { books: ['Genesis', 'Leviticus'] }
    expect(books.verseRestriction(selection)).toEqual({ books: ['Genesis', 'Leviticus'], chaptersByBook: {} })
    expect(books.guessConstraint(selection)).toEqual({ kind: 'one-of-books', books: ['Genesis', 'Leviticus'] })
  })

  describe('toWire', () => {
    it('sends the picked books as numbers in the sender’s own Bible order', () => {
      expect(books.toWire({ books: ['Genesis', 'Leviticus'] }, GENESIS_TO_LEVITICUS)).toEqual({
        Case: 'Books',
        Fields: [[1, 3]],
      })
    })

    it('resolves names case-insensitively', () => {
      expect(books.toWire({ books: ['genesis'] }, GENESIS_TO_LEVITICUS)).toEqual({ Case: 'Books', Fields: [[1]] })
    })

    it('drops a book the sender’s source does not have', () => {
      expect(books.toWire({ books: ['Genesis', 'Tobit'] }, GENESIS_TO_LEVITICUS)).toEqual({
        Case: 'Books',
        Fields: [[1]],
      })
    })
  })

  describe('describeWire', () => {
    it('lists the books in the viewer’s own spelling', () => {
      const viewerBooks = ['1. Mosebog', '2. Mosebog', '3. Mosebog']
      expect(books.describeWire({ Case: 'Books', Fields: [[1, 2]] }, viewerBooks)).toBe('Books: 1. Mosebog, 2. Mosebog')
    })

    it('shows a book the viewer’s source lacks as "Book N"', () => {
      expect(books.describeWire({ Case: 'Books', Fields: [[1, 9]] }, GENESIS_TO_LEVITICUS)).toBe('Books: Genesis, Book 9')
    })

    it('selects nothing when no books are listed', () => {
      expect(books.describeWire({ Case: 'Books', Fields: [[]] }, GENESIS_TO_LEVITICUS)).toBeUndefined()
    })
  })

  describe('guessConstraintForWire', () => {
    it('offers the listed books in the viewer’s own spelling', () => {
      expect(books.guessConstraintForWire({ Case: 'Books', Fields: [[3, 1]] }, GENESIS_TO_LEVITICUS)).toEqual({
        kind: 'one-of-books',
        books: ['Leviticus', 'Genesis'],
      })
    })

    it('drops a book the viewer’s source lacks', () => {
      expect(books.guessConstraintForWire({ Case: 'Books', Fields: [[1, 9]] }, GENESIS_TO_LEVITICUS)).toEqual({
        kind: 'one-of-books',
        books: ['Genesis'],
      })
    })
  })

  // Pinned down so giving this game type its own rule is a deliberate,
  // visible change — see registry.test.ts for the other types staying put.
  it('scores singleplayer guesses by the standard tiered rule', () => {
    const score = (guess: { book: string; chapter?: number; verseNumber?: number }) =>
      books.scoreGuess({ books: ['Rut'] }, RUT_1_16, guess)
    expect(score({ book: 'Ester' })).toBe(0)
    expect(score({ book: 'Rut' })).toBe(10)
    expect(score({ book: 'Rut', chapter: 1 })).toBe(110)
    expect(score({ book: 'Rut', chapter: 1, verseNumber: 16 })).toBe(1110)
  })
})
