import { describe, expect, it } from 'vitest'
import { createLocalVerseSource } from './local-verses'
import type { Verse } from './types'

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
})
