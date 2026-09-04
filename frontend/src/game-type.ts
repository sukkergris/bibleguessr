import type { GameType, VerseRestriction } from './types'

/** The 'all'/'books'/'chapters' scope a GameType represents — same
 * vocabulary as game-setup.ts's SetupScope, since a play request's
 * GameType is chosen with the same book/chapter selectors. */
export type GameTypeScope = 'all' | 'books' | 'chapters'

export function scopeOf(gameType: GameType): GameTypeScope {
  switch (gameType.Case) {
    case 'AllVerses':
      return 'all'
    case 'Books':
      return 'books'
    case 'Chapters':
      return 'chapters'
  }
}

/** Builds the GameType to send with a play request from the scope + whatever
 * restriction the challenger picked (undefined/empty books means "all"). */
export function gameTypeFromRestriction(scope: GameTypeScope, restriction?: VerseRestriction): GameType {
  if (scope === 'books' && restriction?.books.length) {
    return { Case: 'Books', Fields: [restriction.books] }
  }
  if (scope === 'chapters' && restriction?.books.length) {
    return { Case: 'Chapters', Fields: [restriction.chaptersByBook] }
  }
  return { Case: 'AllVerses' }
}

/** A short human-readable label for a GameType, e.g. to show the challenged
 * player what they're being invited to ("Genesis, Exodus" / "All verses"). */
export function describeGameType(gameType: GameType): string {
  switch (gameType.Case) {
    case 'AllVerses':
      return 'All verses'
    case 'Books': {
      const [books] = gameType.Fields
      return books.length > 0 ? books.join(', ') : 'All verses'
    }
    case 'Chapters': {
      const [chaptersByBook] = gameType.Fields
      const parts = Object.entries(chaptersByBook).map(
        ([book, chapters]) => `${book} ${chapters.sort((a, b) => a - b).join(', ')}`,
      )
      return parts.length > 0 ? parts.join('; ') : 'All verses'
    }
  }
}
