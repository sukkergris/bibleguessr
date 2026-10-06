import { describe, expect, it } from 'vitest'
import { groupByBook, needsLoading } from './famous-verses'

// The nerd panel's famous-verses list — see famous-verses.ts and
// docs/web/famous-verses.

const reference = (book: string, bookNumber: number, chapter: number, verseNumber: number) => ({
  book,
  bookNumber,
  chapter,
  verseNumber,
})

describe('groupByBook', () => {
  it('puts each book once, with its references in the order given', () => {
    expect(
      groupByBook([
        reference('1.Mosebog', 1, 1, 1),
        reference('1.Mosebog', 1, 3, 15),
        reference('Johannes', 43, 3, 16),
        reference('Johannes', 43, 17, 3),
      ]),
    ).toEqual([
      { book: '1.Mosebog', references: ['1:1', '3:15'] },
      { book: 'Johannes', references: ['3:16', '17:3'] },
    ])
  })

  it('groups by book number, not by spelling', () => {
    expect(groupByBook([reference('Jeremias', 24, 10, 23), reference('Jeremias.', 24, 29, 11)])).toEqual([
      { book: 'Jeremias', references: ['10:23', '29:11'] },
    ])
  })

  it('gives no groups for no references', () => {
    expect(groupByBook([])).toEqual([])
  })
})

describe('needsLoading', () => {
  it('loads the first time, and again after a failure', () => {
    expect(needsLoading({ kind: 'idle' })).toBe(true)
    expect(needsLoading({ kind: 'failed', reason: 'down' })).toBe(true)
  })

  it('does not load again while loading or once loaded', () => {
    expect(needsLoading({ kind: 'loading' })).toBe(false)
    expect(needsLoading({ kind: 'loaded', count: 0, books: [] })).toBe(false)
  })
})
