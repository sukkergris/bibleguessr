import { describe, expect, it } from 'vitest'
import { BOOK_CATEGORIES, STANDARD_CANON_BOOK_COUNT, layoutBooks } from './book-picker'

// Placeholder names — the real ones always come from the selected Bible,
// so the grouping must work by position, never by spelling.
const canon = Array.from({ length: STANDARD_CANON_BOOK_COUNT }, (_, i) => `Book ${i + 1}`)

describe('BOOK_CATEGORIES', () => {
  it('covers every book of the standard canon exactly once, in order', () => {
    let expectedFirst = 1
    for (const category of BOOK_CATEGORIES) {
      expect(category.firstBook).toBe(expectedFirst)
      expect(category.lastBook).toBeGreaterThanOrEqual(category.firstBook)
      expectedFirst = category.lastBook + 1
    }
    expect(expectedFirst - 1).toBe(STANDARD_CANON_BOOK_COUNT)
  })
})

describe('layoutBooks', () => {
  it('groups a standard canon by testament and category', () => {
    const layout = layoutBooks(canon, canon)
    expect(layout.kind).toBe('grouped')
    if (layout.kind !== 'grouped') return

    expect(layout.testaments.map((t) => t.testament)).toEqual(['old', 'new'])
    const [law] = layout.testaments[0].categories
    expect(law.label).toBe('Law')
    expect(law.books).toEqual(['Book 1', 'Book 2', 'Book 3', 'Book 4', 'Book 5'])
    expect(layout.testaments[1].categories[0].books).toEqual(['Book 40', 'Book 41', 'Book 42', 'Book 43'])
  })

  it('keeps the selected Bible’s own spelling on every tile', () => {
    const danish = [...canon]
    danish[0] = '1.Mosebog'
    danish[65] = 'Aabenbaringen'
    const layout = layoutBooks(danish, danish)
    if (layout.kind !== 'grouped') throw new Error('expected grouped layout')

    expect(layout.testaments[0].categories[0].books[0]).toBe('1.Mosebog')
    expect(layout.testaments[1].categories.at(-1)?.books).toEqual(['Aabenbaringen'])
  })

  it('omits categories and testaments with no visible books', () => {
    const layout = layoutBooks(canon, ['Book 27'])
    if (layout.kind !== 'grouped') throw new Error('expected grouped layout')

    expect(layout.testaments).toHaveLength(1)
    expect(layout.testaments[0].categories).toEqual([
      { id: 'major-prophets', label: 'Major prophets', tone: 3, books: ['Book 27'] },
    ])
  })

  it('matches visible books case-insensitively and shows them in Bible order', () => {
    const layout = layoutBooks(canon, ['book 2', 'BOOK 1'])
    if (layout.kind !== 'grouped') throw new Error('expected grouped layout')
    expect(layout.testaments[0].categories[0].books).toEqual(['Book 1', 'Book 2'])
  })

  it('falls back to a flat list when the source is not a 66-book canon', () => {
    const withExtraBook = [...canon, 'Tobit']
    expect(layoutBooks(withExtraBook, ['Tobit', 'Book 1'])).toEqual({ kind: 'flat', books: ['Book 1', 'Tobit'] })
  })

  it('falls back to a flat list of the given books when one is not in the source', () => {
    expect(layoutBooks(canon, ['Book 1', 'Unknown'])).toEqual({ kind: 'flat', books: ['Book 1', 'Unknown'] })
  })
})
