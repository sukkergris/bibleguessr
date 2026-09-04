// A VerseSource backed by an in-memory Verse[] parsed client-side from a
// file the player supplied (see epub-parser.ts) — no backend involved.
import type { Verse, VerseRestriction, VerseSource } from './types'

// Applies a VerseRestriction (see docs/SCRUM/Feature.BibleSelector.md) to an
// in-memory Verse[] — no backend involved for the local-file case, this
// just filters before the random pick. Undefined or an empty `books` list
// means "default ALL", same as no restriction.
function applyRestriction(verses: Verse[], restriction?: VerseRestriction): Verse[] {
  if (!restriction || restriction.books.length === 0) return verses

  const books = new Set(restriction.books)
  return verses.filter((v) => {
    if (!books.has(v.book)) return false
    const chapters = restriction.chaptersByBook[v.book]
    return !chapters || chapters.includes(v.chapter)
  })
}

export function createLocalVerseSource(verses: Verse[]): VerseSource {
  const translation = verses[0]?.translation ?? ''

  return {
    getTranslations: () => Promise.resolve(translation ? [translation] : []),

    getRandomVerse: (_translation?: string, restriction?: VerseRestriction) => {
      if (verses.length === 0) {
        return Promise.reject(new Error('No verses loaded from the local file.'))
      }

      const candidates = applyRestriction(verses, restriction)
      return candidates.length > 0
        ? Promise.resolve(candidates[Math.floor(Math.random() * candidates.length)])
        : Promise.reject(new Error('No verses match the current book/chapter selection.'))
    },

    getBooks: () => Promise.resolve([...new Set(verses.map((v) => v.book))].sort()),

    getChapters: (book: string) =>
      Promise.resolve(
        [...new Set(verses.filter((v) => v.book === book).map((v) => v.chapter))].sort((a, b) => a - b),
      ),

    getVerseNumbers: (book: string, chapter: number) =>
      Promise.resolve(
        [...new Set(verses.filter((v) => v.book === book && v.chapter === chapter).map((v) => v.verseNumber))].sort(
          (a, b) => a - b,
        ),
      ),
  }
}
