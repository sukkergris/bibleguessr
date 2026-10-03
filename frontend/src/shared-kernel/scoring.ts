import type { Guess, Verse } from './bible'

// The shared kernel's scoring building blocks. Each game type builds its
// own rule from these (see ../game-types/game-type-definition.ts's
// scoreGuess) — typically by choosing its own tiers, e.g. 0 for a part that
// is given at setup. Nothing here may know about a particular game type.
//
// Points awarded per level of a guess, gated on every level before it being
// correct — mirrored by backend/Domain/Scoring.fs, since multiplayer scores
// a guess exactly like singleplayer does (see docs/web/scoring).
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

/** The most a guess can earn with `tiers`: every part right. What a
 * game type built on tieredPoints counts as its maximum. */
export function maxTieredPoints(tiers: Readonly<ScoringTiers>): number {
  return tiers.book + tiers.chapter + tiers.verseNumber
}
