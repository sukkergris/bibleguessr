import { bookAtNumber, bookNumberOf } from './book-numbers'
import { parseTimeSpanMs } from './timer'
import type { GameType, TimeLimit, VerseRestriction, VerseSource } from './types'

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
 * restriction the challenger picked (undefined/empty books means "all").
 *
 * Async: `restriction` carries book NAMES (from the challenger's own
 * <bg-book-selector>/<bg-chapter-selector>, which display names), but
 * GameType.Books/Chapters carry book NUMBERS (see types.ts's GameType doc
 * comment) — so each selected name is resolved to its 1-based position in
 * `verseSource`'s own Bible order first. A name the source can't resolve
 * (shouldn't normally happen — the selector only ever offers names that
 * source itself returned) is silently dropped rather than failing the
 * whole restriction. */
export async function gameTypeFromRestriction(
  scope: GameTypeScope,
  verseSource: VerseSource,
  translation: string | undefined,
  restriction?: VerseRestriction,
): Promise<GameType> {
  if (scope === 'all' || !restriction?.books.length) {
    return { Case: 'AllVerses' }
  }

  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  const numbersOf = (books: string[]) =>
    books
      .map((book) => bookNumberOf(booksInBibleOrder, book))
      .filter((n): n is number => n !== undefined)

  if (scope === 'books') {
    return { Case: 'Books', Fields: [numbersOf(restriction.books)] }
  }

  // scope === 'chapters'
  const chaptersByBookNumber: Record<number, number[]> = {}
  for (const book of restriction.books) {
    const number = bookNumberOf(booksInBibleOrder, book)
    if (number === undefined) continue
    chaptersByBookNumber[number] = restriction.chaptersByBook[book] ?? []
  }
  return { Case: 'Chapters', Fields: [chaptersByBookNumber] }
}

/** The player-facing name of each game-type scope — the single source of
 * truth for this vocabulary. <bg-game-type-select> renders these as its
 * tab labels and describeGameType below uses them in play-request
 * descriptions, so the challenged player sees the same words the
 * challenger chose from. Previously the two were written out separately
 * and had drifted: the selector said "The Bible" while a request for the
 * same game said "All verses". */
export const GAME_TYPE_NAMES: Record<GameTypeScope, string> = {
  all: 'The Bible',
  books: 'Books',
  chapters: 'Chapters',
}

/** A short human-readable label for a GameType, e.g. to show the challenged
 * player what they're being invited to ("Genesis, Exodus" / "All verses").
 *
 * Async: GameType carries book NUMBERS, so displaying names means
 * resolving each one against `verseSource`'s own Bible order (the
 * VIEWER'S OWN source — a challenged player may have a different
 * translation/file than the challenger who built this GameType, so the
 * resolved names shown may legitimately differ from what the challenger
 * saw; the numbers themselves, and thus the actual restriction, are
 * unaffected). A number that doesn't resolve in the viewer's own source
 * (rare — see docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-
 * translation note) shows as "Book N" rather than being dropped, so the
 * viewer at least sees there's a restriction even if the exact book is a
 * mismatch. */
export async function describeGameType(
  gameType: GameType,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<string> {
  if (gameType.Case === 'AllVerses') return GAME_TYPE_NAMES.all

  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  const nameOf = (number: number) => bookAtNumber(booksInBibleOrder, number) ?? `Book ${number}`

  // An empty selection is the same game as no restriction at all, so it
  // reads as the unrestricted mode rather than an empty "Books: ".
  if (gameType.Case === 'Books') {
    const [bookNumbers] = gameType.Fields
    if (bookNumbers.length === 0) return GAME_TYPE_NAMES.all
    return `${GAME_TYPE_NAMES.books}: ${bookNumbers.map(nameOf).join(', ')}`
  }

  // gameType.Case === 'Chapters'
  const [chaptersByBookNumber] = gameType.Fields
  const parts = Object.entries(chaptersByBookNumber).map(
    ([bookNumber, chapters]) => `${nameOf(Number(bookNumber))} ${[...chapters].sort((a, b) => a - b).join(', ')}`,
  )
  if (parts.length === 0) return GAME_TYPE_NAMES.all
  return `${GAME_TYPE_NAMES.chapters}: ${parts.join('; ')}`
}

/** Which books a Books-scoped GameType restricts the guess form's Book
 * field to, resolved to the VIEWER'S OWN spelling via `verseSource` — see
 * bg-app.ts's _allowedBooksForGuessForm, which this mirrors for a
 * multiplayer round's GameType instead of singleplayer's VerseRestriction.
 * Undefined (AllVerses/Chapters) keeps the guess form's default free-text
 * autocomplete over every book. A book number the viewer's own source
 * can't resolve is dropped (same "rare mismatch" spirit as
 * describeGameType, but here dropping is correct — there's no sane
 * "allowed" entry to show for a book this source doesn't have at all). */
export async function allowedBooksForGuessForm(
  gameType: GameType,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<string[] | undefined> {
  if (gameType.Case !== 'Books') return undefined

  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  const [bookNumbers] = gameType.Fields
  return bookNumbers
    .map((number) => bookAtNumber(booksInBibleOrder, number))
    .filter((book): book is string => book !== undefined)
}

/** The single book a Chapters-scoped GameType commits a game to, resolved
 * to the VIEWER'S OWN spelling — see bg-app.ts's _lockedBookForGuessForm,
 * which this mirrors. Undefined (AllVerses/Books, or an unresolvable book
 * number) leaves the guess form's Book field editable. */
export async function lockedBookForGuessForm(
  gameType: GameType,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<string | undefined> {
  if (gameType.Case !== 'Chapters') return undefined
  const [chaptersByBookNumber] = gameType.Fields
  const [firstBookNumber] = Object.keys(chaptersByBookNumber).map(Number)
  if (firstBookNumber === undefined) return undefined

  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  return bookAtNumber(booksInBibleOrder, firstBookNumber)
}

/** Which chapters a Chapters-scoped GameType restricts the guess form's
 * Chapter field to, for the one book lockedBookForGuessForm names — see
 * bg-app.ts's _allowedChaptersForGuessForm, which this mirrors. Undefined
 * otherwise. */
export function allowedChaptersForGuessForm(gameType: GameType): number[] | undefined {
  if (gameType.Case !== 'Chapters') return undefined
  const [chaptersByBookNumber] = gameType.Fields
  const [firstBookNumber] = Object.keys(chaptersByBookNumber).map(Number)
  return firstBookNumber === undefined ? undefined : chaptersByBookNumber[firstBookNumber]
}

/** The guessing player's own book NUMBER for `book` (as typed/selected in
 * the guess form), resolved against `verseSource`'s own Bible order — set
 * on a submitted Guess (see types.ts's Guess.bookNumber doc comment) so
 * multiplayer scoring can match by number instead of name. Undefined if
 * this source doesn't recognize `book` at all (backend falls back to name
 * matching in that case). */
export async function bookNumberOfGuess(
  book: string,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<number | undefined> {
  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  return bookNumberOf(booksInBibleOrder, book)
}

/** Everything a challenged player is agreeing to, in one line: which
 * verses, how many rounds, and how long they get per verse — see
 * <bg-play-requests>, which shows this under "<name> wants to play".
 *
 * Deliberately separate from describeGameType (which answers only "which
 * verses") because the round count and time limit live on the PlayRequest
 * itself, not on the GameType — see types.ts's PlayRequest and
 * docs/SCRUM/Feature.Time.md. */
export async function describeChallenge(
  gameType: GameType,
  roundCount: number,
  roundTimeLimit: TimeLimit,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<string> {
  const verses = await describeGameType(gameType, verseSource, translation)
  const rounds = `${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`
  const time =
    roundTimeLimit.Case === 'Unlimited'
      ? 'No time limit'
      : `${Math.round(parseTimeSpanMs(roundTimeLimit.Fields[0]) / 1000)}s per verse`

  return `${verses} · ${rounds} · ${time}`
}
