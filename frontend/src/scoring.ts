import type { Guess, Verse } from './types'

// Points awarded per level of a guess, gated on every level before it being
// correct — mirrors backend/Domain/Game.fs's Scoring.pointsForVerseGuess.
const BOOK_POINTS = 10
const CHAPTER_POINTS = 100
const VERSE_NUMBER_POINTS = 1000

/**
 * Points for a guess against the round's actual verse: each level only
 * counts if every level before it was also guessed correctly (book alone
 * is worth BOOK_POINTS; the chapter only counts if the book was also
 * right; the verse number only counts if both book and chapter were
 * right). Book matching is case-insensitive, mirroring the backend's
 * `String.Equals(..., StringComparison.OrdinalIgnoreCase)`.
 *
 * Extracted from bg-app.ts so it's directly testable without instantiating
 * the Lit element, and kept as a standalone sibling to the backend's
 * Scoring.pointsForVerseGuess for cross-language consistency.
 */
export function scoreGuess(verse: Verse, guess: Guess): number {
  const bookCorrect = guess.book.trim().toLowerCase() === verse.book.trim().toLowerCase()
  if (!bookCorrect) return 0

  const chapterCorrect = guess.chapter !== undefined && guess.chapter === verse.chapter
  if (!chapterCorrect) return BOOK_POINTS

  const verseNumberCorrect = guess.verseNumber !== undefined && guess.verseNumber === verse.verseNumber
  if (!verseNumberCorrect) return BOOK_POINTS + CHAPTER_POINTS

  return BOOK_POINTS + CHAPTER_POINTS + VERSE_NUMBER_POINTS
}
