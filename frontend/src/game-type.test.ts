import { describe, expect, it } from 'vitest'
import {
  allowedBooksForGuessForm,
  allowedChaptersForGuessForm,
  bookNumberOfGuess,
  describeChallenge,
  describeGameType,
  gameTypeFromRestriction,
  lockedBookForGuessForm,
  scopeOf,
} from './game-type'
import type { GameType, VerseSource } from './types'

// A minimal VerseSource stub whose only meaningful behavior is
// getBooksInBibleOrder(translation) — everything else is unused by the
// functions under test here.
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

const GENESIS_TO_LEVITICUS = ['Genesis', 'Exodus', 'Leviticus']

describe('scopeOf', () => {
  it('maps AllVerses to all', () => {
    expect(scopeOf({ Case: 'AllVerses' })).toBe('all')
  })

  it('maps Books to books', () => {
    expect(scopeOf({ Case: 'Books', Fields: [[1]] })).toBe('books')
  })

  it('maps Chapters to chapters', () => {
    expect(scopeOf({ Case: 'Chapters', Fields: [{ 1: [1] }] })).toBe('chapters')
  })
})

describe('gameTypeFromRestriction', () => {
  it('builds AllVerses for the all scope regardless of restriction', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const result = await gameTypeFromRestriction('all', source, undefined, {
      books: ['Genesis'],
      chaptersByBook: {},
    })
    expect(result).toEqual({ Case: 'AllVerses' })
  })

  it('builds AllVerses for books scope with no restriction selected yet', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const result = await gameTypeFromRestriction('books', source, undefined, undefined)
    expect(result).toEqual({ Case: 'AllVerses' })
  })

  it('builds Books with book numbers resolved from the source Bible order', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const restriction = { books: ['Genesis', 'Leviticus'], chaptersByBook: {} }

    const result = await gameTypeFromRestriction('books', source, undefined, restriction)

    expect(result).toEqual({ Case: 'Books', Fields: [[1, 3]] })
  })

  it('builds Chapters with book numbers and their chapter sets', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const restriction = { books: ['Exodus'], chaptersByBook: { Exodus: [1, 2] } }

    const result = await gameTypeFromRestriction('chapters', source, undefined, restriction)

    expect(result).toEqual({ Case: 'Chapters', Fields: [{ 2: [1, 2] }] })
  })

  it('drops a selected book the source cannot resolve a number for', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const restriction = { books: ['Genesis', 'Numbers'], chaptersByBook: {} }

    const result = await gameTypeFromRestriction('books', source, undefined, restriction)

    expect(result).toEqual({ Case: 'Books', Fields: [[1]] })
  })
})

describe('describeGameType', () => {
  // The label must use the same vocabulary the challenger picked from in
  // <bg-game-type-select> ("The Bible" / "Books" / "Chapters"), so the
  // challenged player recognises what they are being invited to.
  it('describes AllVerses using the selector’s own name for it', async () => {
    const source = stubSource([])
    expect(await describeGameType({ Case: 'AllVerses' }, source, undefined)).toBe('The Bible')
  })

  it('describes Books by resolving numbers to the VIEWER’S OWN spelling', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const gameType: GameType = { Case: 'Books', Fields: [[1, 3]] }

    expect(await describeGameType(gameType, source, undefined)).toBe('Books: Genesis, Leviticus')
  })

  it('describes Chapters with sorted chapter numbers per resolved book', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const gameType: GameType = { Case: 'Chapters', Fields: [{ 1: [3, 1, 2] }] }

    expect(await describeGameType(gameType, source, undefined)).toBe('Chapters: Genesis 1, 2, 3')
  })

  it('falls back to "Book N" for a number the viewer’s own source cannot resolve', async () => {
    const source = stubSource(['Genesis'])
    const gameType: GameType = { Case: 'Books', Fields: [[99]] }

    expect(await describeGameType(gameType, source, undefined)).toBe('Books: Book 99')
  })
})

describe('allowedBooksForGuessForm', () => {
  it('resolves book numbers to the given source’s own spelling', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const gameType: GameType = { Case: 'Books', Fields: [[1, 2]] }

    expect(await allowedBooksForGuessForm(gameType, source, undefined)).toEqual(['Genesis', 'Exodus'])
  })

  it('returns undefined for AllVerses', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    expect(await allowedBooksForGuessForm({ Case: 'AllVerses' }, source, undefined)).toBeUndefined()
  })

  it('returns undefined for Chapters', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const gameType: GameType = { Case: 'Chapters', Fields: [{ 1: [1] }] }
    expect(await allowedBooksForGuessForm(gameType, source, undefined)).toBeUndefined()
  })

  it('drops a book number the source cannot resolve', async () => {
    const source = stubSource(['Genesis'])
    const gameType: GameType = { Case: 'Books', Fields: [[1, 99]] }
    expect(await allowedBooksForGuessForm(gameType, source, undefined)).toEqual(['Genesis'])
  })
})

describe('lockedBookForGuessForm', () => {
  it('resolves the single book number to the given source’s own spelling', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const gameType: GameType = { Case: 'Chapters', Fields: [{ 2: [1, 2] }] }

    expect(await lockedBookForGuessForm(gameType, source, undefined)).toBe('Exodus')
  })

  it('returns undefined for AllVerses', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    expect(await lockedBookForGuessForm({ Case: 'AllVerses' }, source, undefined)).toBeUndefined()
  })

  it('returns undefined for Books', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    const gameType: GameType = { Case: 'Books', Fields: [[1]] }
    expect(await lockedBookForGuessForm(gameType, source, undefined)).toBeUndefined()
  })
})

describe('allowedChaptersForGuessForm', () => {
  it('returns the chapter list for the locked book number in Chapters', () => {
    const gameType: GameType = { Case: 'Chapters', Fields: [{ 1: [1, 2, 3] }] }
    expect(allowedChaptersForGuessForm(gameType)).toEqual([1, 2, 3])
  })

  it('returns undefined for AllVerses', () => {
    expect(allowedChaptersForGuessForm({ Case: 'AllVerses' })).toBeUndefined()
  })

  it('returns undefined for Books', () => {
    const gameType: GameType = { Case: 'Books', Fields: [[1]] }
    expect(allowedChaptersForGuessForm(gameType)).toBeUndefined()
  })
})

describe('bookNumberOfGuess', () => {
  it('resolves a typed book name to its number in the source', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    expect(await bookNumberOfGuess('Exodus', source, undefined)).toBe(2)
  })

  it('returns undefined for a book the source does not recognize', async () => {
    const source = stubSource(GENESIS_TO_LEVITICUS)
    expect(await bookNumberOfGuess('Numbers', source, undefined)).toBeUndefined()
  })
})

// The play request should tell the challenged player everything they are
// agreeing to before they click Accept — not just which verses, but how
// many rounds and how long they get per verse.
describe('describeChallenge', () => {
  const source = stubSource(GENESIS_TO_LEVITICUS)

  it('combines the game type, round count and time per verse', async () => {
    const description = await describeChallenge(
      { Case: 'AllVerses' },
      5,
      { Case: 'LimitedTo', Fields: ['00:00:30'] },
      source,
      undefined,
    )

    expect(description).toBe('The Bible · 5 rounds · 30s per verse')
  })

  it('says when there is no time limit rather than omitting it', async () => {
    const description = await describeChallenge({ Case: 'AllVerses' }, 3, { Case: 'Unlimited' }, source, undefined)

    expect(description).toBe('The Bible · 3 rounds · No time limit')
  })

  it('keeps the book selection alongside the round and time details', async () => {
    const description = await describeChallenge(
      { Case: 'Books', Fields: [[1, 3]] },
      10,
      { Case: 'LimitedTo', Fields: ['00:01:00'] },
      source,
      undefined,
    )

    expect(description).toBe('Books: Genesis, Leviticus · 10 rounds · 60s per verse')
  })

  it('uses the singular for a one-round game', async () => {
    const description = await describeChallenge({ Case: 'AllVerses' }, 1, { Case: 'Unlimited' }, source, undefined)

    expect(description).toBe('The Bible · 1 round · No time limit')
  })
})
