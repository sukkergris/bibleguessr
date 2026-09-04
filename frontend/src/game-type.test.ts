import { describe, expect, it } from 'vitest'
import { describeGameType, gameTypeFromRestriction, scopeOf } from './game-type'
import type { GameType } from './types'

describe('scopeOf', () => {
  it('maps AllVerses to all', () => {
    expect(scopeOf({ Case: 'AllVerses' })).toBe('all')
  })

  it('maps Books to books', () => {
    expect(scopeOf({ Case: 'Books', Fields: [['Genesis']] })).toBe('books')
  })

  it('maps Chapters to chapters', () => {
    expect(scopeOf({ Case: 'Chapters', Fields: [{ Genesis: [1] }] })).toBe('chapters')
  })
})

describe('gameTypeFromRestriction', () => {
  it('builds AllVerses for the all scope regardless of restriction', () => {
    expect(gameTypeFromRestriction('all', { books: ['Genesis'], chaptersByBook: {} })).toEqual({ Case: 'AllVerses' })
  })

  it('builds AllVerses for books scope with no restriction selected yet', () => {
    expect(gameTypeFromRestriction('books', undefined)).toEqual({ Case: 'AllVerses' })
  })

  it('builds Books from a books-scope restriction', () => {
    const restriction = { books: ['Genesis', 'Exodus'], chaptersByBook: {} }
    expect(gameTypeFromRestriction('books', restriction)).toEqual({
      Case: 'Books',
      Fields: [['Genesis', 'Exodus']],
    })
  })

  it('builds Chapters from a chapters-scope restriction', () => {
    const restriction = { books: ['Genesis'], chaptersByBook: { Genesis: [1, 2] } }
    expect(gameTypeFromRestriction('chapters', restriction)).toEqual({
      Case: 'Chapters',
      Fields: [{ Genesis: [1, 2] }],
    })
  })
})

describe('describeGameType', () => {
  it('describes AllVerses', () => {
    expect(describeGameType({ Case: 'AllVerses' })).toBe('All verses')
  })

  it('describes Books as a comma-separated list', () => {
    const gameType: GameType = { Case: 'Books', Fields: [['Genesis', 'Exodus']] }
    expect(describeGameType(gameType)).toBe('Genesis, Exodus')
  })

  it('describes Chapters with sorted chapter numbers per book', () => {
    const gameType: GameType = { Case: 'Chapters', Fields: [{ Genesis: [3, 1, 2] }] }
    expect(describeGameType(gameType)).toBe('Genesis 1, 2, 3')
  })
})
