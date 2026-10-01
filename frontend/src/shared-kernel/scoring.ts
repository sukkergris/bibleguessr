import type { Guess, Verse } from './bible'

// The shared kernel's standard singleplayer scoring rule. Each game type
// chooses its own rule (see ../game-types/game-type-definition.ts's
// scoreGuess); today they all choose this one.
//
// Points awarded per level of a guess, gated on every level before it being
// correct — mirrors backend/Domain/Scoring.fs's Scoring.pointsForVerseGuess.
/** What each level of a correct guess is worth. */
export interface ScoringTiers {
  book: number
  chapter: number
  verseNumber: number
}

export const STANDARD_TIERS: Readonly<ScoringTiers> = { book: 10, chapter: 100, verseNumber: 1000 }

/**
 * Points for a guess against the round's actual verse: each level only
 * counts if every level before it was also guessed correctly (the book
 * earns `tiers.book`; the chapter only counts if the book was also right;
 * the verse number only counts if both book and chapter were right). Book
 * matching is case-insensitive, mirroring the backend's
 * `String.Equals(..., StringComparison.OrdinalIgnoreCase)`. A game type
 * builds its own rule from this with its own tiers.
 */
export function tieredPoints(verse: Verse, guess: Guess, tiers: Readonly<ScoringTiers>): number {
  const bookCorrect = guess.book.trim().toLowerCase() === verse.book.trim().toLowerCase()
  if (!bookCorrect) return 0

  const chapterCorrect = guess.chapter !== undefined && guess.chapter === verse.chapter
  if (!chapterCorrect) return tiers.book

  const verseNumberCorrect = guess.verseNumber !== undefined && guess.verseNumber === verse.verseNumber
  if (!verseNumberCorrect) return tiers.book + tiers.chapter

  return tiers.book + tiers.chapter + tiers.verseNumber
}

/** The standard rule: tieredPoints with STANDARD_TIERS. Kept as a sibling
 * to the backend's Scoring.pointsForVerseGuess for cross-language
 * consistency. */
export function standardSingleplayerPoints(verse: Verse, guess: Guess): number {
  return tieredPoints(verse, guess, STANDARD_TIERS)
}
