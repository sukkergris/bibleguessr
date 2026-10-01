import { describe, expect, it } from 'vitest'
import { describeChallenge } from './challenge-description'
import type { VerseSource } from './types'

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
