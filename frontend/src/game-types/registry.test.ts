import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Verse, VerseSource } from '../shared-kernel/bible'
import { books } from './books/books'
import { chapters } from './chapters/chapters'
import { theBible } from './the-bible/the-bible'
import {
  GAME_TYPE_IDS,
  describeWire,
  freshChoice,
  guessConstraintForWire,
  guessConstraintOf,
  isReady,
  nameOf,
  scoreGuessOf,
  toWire,
  verseRestrictionOf,
  type GameTypeChoice,
} from './registry'

// A minimal VerseSource stub whose only meaningful behavior is
// getBooksInBibleOrder — everything else is unused by the registry.
function stubSource(booksInBibleOrder: string[]): VerseSource {
  return {
    getTranslations: () => Promise.resolve([]),
    getRandomVerse: () => Promise.reject(new Error('not used in this test')),
    getBooks: () => Promise.resolve([...booksInBibleOrder].sort()),
    getBooksInBibleOrder: () => Promise.resolve(booksInBibleOrder),
    getChapters: () => Promise.resolve([]),
    getVerseNumbers: () => Promise.resolve([]),
    lookupVerse: () => Promise.reject(new Error('not used in this test')),
  }
}

const source = stubSource(['Genesis', 'Exodus', 'Leviticus'])

describe('the game type list', () => {
  // The label must use the same vocabulary everywhere a player meets it
  // (start screen, challenge tabs, play-request descriptions).
  it('offers The Bible, Books and Chapters, in that order', () => {
    expect(GAME_TYPE_IDS.map(nameOf)).toEqual(['The Bible', 'Books', 'Chapters'])
  })
})

describe('freshChoice / isReady', () => {
  it('lets The Bible start straight away', () => {
    expect(isReady(freshChoice('the-bible'))).toBe(true)
  })

  it('makes Books and Chapters wait for a selection', () => {
    expect(isReady(freshChoice('books'))).toBe(false)
    expect(isReady(freshChoice('chapters'))).toBe(false)
  })
})

describe('singleplayer dispatch', () => {
  it('asks the choice’s own game type', () => {
    const choice: GameTypeChoice = { gameType: 'books', selection: { books: ['Exodus'] } }
    expect(verseRestrictionOf(choice)).toEqual({ books: ['Exodus'], chaptersByBook: {} })
    expect(guessConstraintOf(choice)).toEqual({ kind: 'one-of-books', books: ['Exodus'] })
  })

  it('treats a choice with nothing picked as the whole Bible', () => {
    expect(verseRestrictionOf(freshChoice('chapters'))).toBeUndefined()
    expect(guessConstraintOf(freshChoice('chapters'))).toEqual({ kind: 'any-book' })
  })
})

describe('toWire', () => {
  it('sends the choice’s own wire case, resolved against the sender’s source', async () => {
    const choice: GameTypeChoice = { gameType: 'chapters', selection: { book: 'Exodus', chapters: [1, 2] } }
    expect(await toWire(choice, source, undefined)).toEqual({ Case: 'Chapters', Fields: [{ 2: [1, 2] }] })
  })

  it('sends AllVerses for a game type with nothing picked yet', async () => {
    expect(await toWire(freshChoice('books'), source, undefined)).toEqual({ Case: 'AllVerses' })
  })
})

describe('describeWire', () => {
  it('asks the wire case’s own game type', async () => {
    expect(await describeWire({ Case: 'Books', Fields: [[1, 3]] }, source, undefined)).toBe('Books: Genesis, Leviticus')
    expect(await describeWire({ Case: 'AllVerses' }, source, undefined)).toBe('The Bible')
  })

  // An empty selection is the same game as no restriction at all, so it
  // reads as the unrestricted game rather than an empty "Books: ".
  it('describes a selection of nothing as The Bible', async () => {
    expect(await describeWire({ Case: 'Books', Fields: [[]] }, source, undefined)).toBe('The Bible')
    expect(await describeWire({ Case: 'Chapters', Fields: [{}] }, source, undefined)).toBe('The Bible')
  })
})

describe('guessConstraintForWire', () => {
  it('asks the wire case’s own game type', async () => {
    expect(await guessConstraintForWire({ Case: 'AllVerses' }, source, undefined)).toEqual({ kind: 'any-book' })
    expect(await guessConstraintForWire({ Case: 'Chapters', Fields: [{ 1: [3] }] }, source, undefined)).toEqual({
      kind: 'fixed-book',
      book: 'Genesis',
      chapters: [3],
    })
  })
})

describe('scoreGuessOf', () => {
  const verse: Verse = { book: 'Exodus', chapter: 3, verseNumber: 14, text: '', translation: 'Test', reference: 'Exodus 3:14' }
  const guess = { book: 'Exodus', chapter: 3 }

  afterEach(() => vi.restoreAllMocks())

  // Each game type owns its scoring rule: the registry must ask the
  // choice's own type and no other, so changing one type's rule can't
  // affect a game of another type.
  it('scores by the choice’s own game type only', () => {
    const spies = {
      theBible: vi.spyOn(theBible, 'scoreGuess').mockReturnValue(1),
      books: vi.spyOn(books, 'scoreGuess').mockReturnValue(2),
      chapters: vi.spyOn(chapters, 'scoreGuess').mockReturnValue(3),
    }

    expect(scoreGuessOf({ gameType: 'books', selection: { books: ['Exodus'] } }, verse, guess)).toBe(2)
    expect(spies.books).toHaveBeenCalledWith({ books: ['Exodus'] }, verse, guess)
    expect(spies.theBible).not.toHaveBeenCalled()
    expect(spies.chapters).not.toHaveBeenCalled()
  })

  it('scores a choice with nothing picked as The Bible', () => {
    const theBibleRule = vi.spyOn(theBible, 'scoreGuess').mockReturnValue(1)
    expect(scoreGuessOf(freshChoice('chapters'), verse, guess)).toBe(1)
    expect(theBibleRule).toHaveBeenCalled()
  })
})
