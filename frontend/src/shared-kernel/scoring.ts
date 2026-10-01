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
  const correct = correctParts(verse, guess)
  return (
    (correct.book ? tiers.book : 0) +
    (correct.chapter ? tiers.chapter : 0) +
    (correct.verseNumber ? tiers.verseNumber : 0)
  )
}

/** Which parts of a guess count as right. Each part only counts when every
 * part before it is right too — the right numbers in the wrong book count
 * for nothing — and a part that wasn't guessed isn't right. The one source
 * of truth for both the points (tieredPoints) and anything that shows the
 * parts, like a shared daily-quiz result. */
export function correctParts(verse: Verse, guess: Guess): Record<keyof ScoringTiers, boolean> {
  const book = guess.book.trim().toLowerCase() === verse.book.trim().toLowerCase()
  const chapter = book && guess.chapter !== undefined && guess.chapter === verse.chapter
  const verseNumber = chapter && guess.verseNumber !== undefined && guess.verseNumber === verse.verseNumber
  return { book, chapter, verseNumber }
}

/** The standard rule: tieredPoints with STANDARD_TIERS. Kept as a sibling
 * to the backend's Scoring.pointsForVerseGuess for cross-language
 * consistency. */
export function standardSingleplayerPoints(verse: Verse, guess: Guess): number {
  return tieredPoints(verse, guess, STANDARD_TIERS)
}
