import { describe, expect, it } from 'vitest'
import { createLocalVerseSource } from './local-verses'
import type { Verse, VerseRestriction } from './types'

function makeVerse(book: string, chapter: number, verseNumber: number, translation = 'NWT'): Verse {
  return {
    book,
    chapter,
    verseNumber,
    text: `${book} ${chapter}:${verseNumber} text`,
    translation,
    reference: `${book} ${chapter}:${verseNumber}`,
  }
}

describe('createLocalVerseSource', () => {
  it('reports no translations for an empty verse list', async () => {
    const source = createLocalVerseSource([])
    expect(await source.getTranslations()).toEqual([])
  })

  it("reports the first verse's translation", async () => {
    const source = createLocalVerseSource([makeVerse('John', 3, 16, 'NWT'), makeVerse('John', 3, 17, 'NWT')])
    expect(await source.getTranslations()).toEqual(['NWT'])
  })

  it('rejects getRandomVerse when there are no verses loaded', async () => {
    const source = createLocalVerseSource([])
    await expect(source.getRandomVerse()).rejects.toThrow('No verses loaded from the local file.')
  })

  it('resolves getRandomVerse with one of the loaded verses', async () => {
    const verses = [makeVerse('John', 3, 16), makeVerse('Genesis', 1, 1)]
    const source = createLocalVerseSource(verses)
    const result = await source.getRandomVerse()
    expect(verses).toContainEqual(result)
  })

  it('returns distinct, alphabetically sorted book names', async () => {
    const source = createLocalVerseSource([
      makeVerse('John', 3, 16),
      makeVerse('Genesis', 1, 1),
      makeVerse('John', 3, 17),
      makeVerse('Acts', 1, 1),
    ])
    expect(await source.getBooks()).toEqual(['Acts', 'Genesis', 'John'])
  })

  it('returns distinct book names in Bible order, not alphabetical (see Feature.BooksGameSorting.md)', async () => {
    const source = createLocalVerseSource([
      makeVerse('John', 3, 16),
      makeVerse('Genesis', 1, 1),
      makeVerse('John', 3, 17), // duplicate book, should not appear twice or move the first occurrence
      makeVerse('Acts', 1, 1),
    ])
    // First-encounter order — Genesis/John/Acts alphabetize very
    // differently, so this only passes if order isn't sorted at all.
    expect(await source.getBooksInBibleOrder()).toEqual(['John', 'Genesis', 'Acts'])
  })

  it('returns distinct, numerically sorted chapters for a book', async () => {
    const source = createLocalVerseSource([
      makeVerse('John', 3, 16),
      makeVerse('John', 1, 1),
      makeVerse('John', 3, 17),
      makeVerse('Genesis', 1, 1),
    ])
    expect(await source.getChapters('John')).toEqual([1, 3])
  })

  it('returns an empty chapter list for a book with no verses', async () => {
    const source = createLocalVerseSource([makeVerse('John', 3, 16)])
    expect(await source.getChapters('Nonexistent Book')).toEqual([])
  })

  it('returns distinct, numerically sorted verse numbers for a book/chapter', async () => {
    const source = createLocalVerseSource([
      makeVerse('John', 3, 16),
      makeVerse('John', 3, 1),
      makeVerse('John', 3, 16), // duplicate, should be deduped
      makeVerse('John', 4, 1), // different chapter, should be excluded
    ])
    expect(await source.getVerseNumbers('John', 3)).toEqual([1, 16])
  })

  describe('getRandomVerse with a restriction (see docs/SCRUM/Feature.BibleSelector.md)', () => {
    const verses = [
      makeVerse('Genesis', 1, 1),
      makeVerse('Genesis', 2, 1),
      makeVerse('Exodus', 1, 1),
      makeVerse('John', 3, 16),
    ]

    it('an undefined restriction behaves like no restriction at all (default ALL)', async () => {
      const source = createLocalVerseSource(verses)
      const result = await source.getRandomVerse(undefined, undefined)
      expect(verses).toContainEqual(result)
    })

    it('an empty books list behaves like no restriction (default ALL)', async () => {
      const restriction: VerseRestriction = { books: [], chaptersByBook: {} }
      const source = createLocalVerseSource(verses)
      const result = await source.getRandomVerse(undefined, restriction)
      expect(verses).toContainEqual(result)
    })

    it('restricts to only the selected books', async () => {
      const restriction: VerseRestriction = { books: ['Genesis'], chaptersByBook: {} }
      const source = createLocalVerseSource(verses)

      for (let i = 0; i < 20; i++) {
        const result = await source.getRandomVerse(undefined, restriction)
        expect(result.book).toBe('Genesis')
      }
    })

    it('further restricts to selected chapters within a selected book', async () => {
      const restriction: VerseRestriction = { books: ['Genesis'], chaptersByBook: { Genesis: [1] } }
      const source = createLocalVerseSource(verses)

      for (let i = 0; i < 20; i++) {
        const result = await source.getRandomVerse(undefined, restriction)
        expect(result.book).toBe('Genesis')
        expect(result.chapter).toBe(1)
      }
    })

    it('rejects when nothing matches the restriction', async () => {
      const restriction: VerseRestriction = { books: ['Revelation'], chaptersByBook: {} }
      const source = createLocalVerseSource(verses)
      await expect(source.getRandomVerse(undefined, restriction)).rejects.toThrow(
        'No verses match the current book/chapter selection.',
      )
    })
  })
})
