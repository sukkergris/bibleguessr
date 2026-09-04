import { describe, expect, it } from 'vitest'
import { bookAtNumber, bookNumberOf } from './book-numbers'

// Mirrors backend/Domain/Verses.fs's Verse.bookNumberOf/bookAtNumber — see
// BookNumberTests.fs's doc comment for the bug this fixes: two players'
// translations/uploaded files spell book names differently (even within
// the same translation — bibelen-dk's own loader has produced both
// "Jeremias" and "Jeremias." for one book), so matching a verse reference
// by NAME across players is fragile. A book's NUMBER (its 1-based
// position in a source's own Bible-order book list) is stable and
// spelling-independent.

describe('bookNumberOf', () => {
  it('returns the 1-based position of a book in an ordered list', () => {
    const books = ['Genesis', 'Exodus', 'Leviticus']
    expect(bookNumberOf(books, 'Genesis')).toBe(1)
    expect(bookNumberOf(books, 'Exodus')).toBe(2)
  })

  it('is case-insensitive', () => {
    const books = ['Genesis', 'Exodus']
    expect(bookNumberOf(books, 'genesis')).toBe(1)
    expect(bookNumberOf(books, 'GENESIS')).toBe(1)
  })

  it('returns undefined for a book not in the list', () => {
    const books = ['Genesis', 'Exodus']
    expect(bookNumberOf(books, 'Leviticus')).toBeUndefined()
  })
})

describe('bookAtNumber', () => {
  it('returns the book name at a 1-based position', () => {
    const books = ['Genesis', 'Exodus', 'Leviticus']
    expect(bookAtNumber(books, 1)).toBe('Genesis')
    expect(bookAtNumber(books, 2)).toBe('Exodus')
  })

  it('returns undefined for an out-of-range position', () => {
    const books = ['Genesis', 'Exodus']
    expect(bookAtNumber(books, 0)).toBeUndefined()
    expect(bookAtNumber(books, 3)).toBeUndefined()
  })

  it('round-trips with bookNumberOf across two differently-spelled book lists', () => {
    // The actual bug this exists to fix: "Dommer" and "Dommerne" — two
    // spellings of the same book — sit at the same position (7) in their
    // respective, otherwise-identical-order lists.
    const listA = ['1.Mosebog', '2.Mosebog', '3.Mosebog', '4.Mosebog', '5.Mosebog', 'Josua', 'Dommer']
    const listB = ['1.Mosebog', '2.Mosebog', '3.Mosebog', '4.Mosebog', '5.Mosebog', 'Josua', 'Dommerne']

    const number = bookNumberOf(listA, 'Dommer')
    expect(number).toBe(7)
    expect(bookAtNumber(listB, number!)).toBe('Dommerne')
  })
})
