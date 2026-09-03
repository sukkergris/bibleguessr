// A VerseSource backed by an in-memory Verse[] parsed client-side from a
// file the player supplied (see epub-parser.ts) — no backend involved.
import type { Verse, VerseSource } from './types'

export function createLocalVerseSource(verses: Verse[]): VerseSource {
  const translation = verses[0]?.translation ?? ''

  return {
    getTranslations: () => Promise.resolve(translation ? [translation] : []),

    getRandomVerse: () =>
      verses.length > 0
        ? Promise.resolve(verses[Math.floor(Math.random() * verses.length)])
        : Promise.reject(new Error('No verses loaded from the local file.')),

    getBooks: () => Promise.resolve([...new Set(verses.map((v) => v.book))].sort()),
  }
}
