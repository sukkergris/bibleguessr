// "Books" game type: verses come only from the books the player picked,
// and the guess form offers only those books. See
// ../game-type-definition.ts for the rules a game type follows.

import { html } from 'lit'
import { bookAtNumber, bookNumberOf } from '../../shared-kernel/book-numbers'
import type { GameType } from '../../shared-kernel/game-type-wire'
import { ALL_COLUMNS, type ResultColumn } from '../../shared-kernel/result-sharing'
import { STANDARD_TIERS, maxTieredPoints, tieredPoints, type ScoringTiers } from '../../shared-kernel/scoring'
import type { GameTypeDefinition } from '../game-type-definition'
import './book-selector'

export type BooksWire = Extract<GameType, { Case: 'Books' }>

/** The picked books, in the player's own spelling. Never empty — the
 * selector reports "nothing picked" as undefined instead. */
export interface BooksSelection {
  books: string[]
}

const NAME = 'Books'

/** Whether only one book was picked — then the guess form offers nothing
 * else, so the book is a given. */
const bookIsGiven = (selection: BooksSelection) => new Set(selection.books).size === 1

/** What's given at setup is no achievement, so it earns nothing: with one
 * book picked, the book. Otherwise the standard tiers. */
const LONE_BOOK_TIERS: Readonly<ScoringTiers> = { ...STANDARD_TIERS, book: 0 }

const tiersFor = (selection: BooksSelection) => (bookIsGiven(selection) ? LONE_BOOK_TIERS : STANDARD_TIERS)

/** The same given book left out of a shared result, where it'd always
 * show ✅. */
const LONE_BOOK_COLUMNS: readonly ResultColumn[] = ['chapter', 'verseNumber']

export const books: GameTypeDefinition<BooksSelection, BooksWire> = {
  name: NAME,
  hint: 'choose which books to use',
  defaultSelection: undefined,

  renderSelector: (host) => html`
    <bg-book-selector
      .verseSource=${host.verseSource}
      .translation=${host.translation}
      .initialSelection=${host.selection?.books}
      @books-selection-changed=${(event: CustomEvent<BooksSelection | undefined>) => host.onChange(event.detail)}
    ></bg-book-selector>
  `,

  verseRestriction: (selection) => ({ books: selection.books, chaptersByBook: {} }),
  guessConstraint: (selection) => ({
    kind: 'one-of-books',
    books: selection.books,
    givenBook: bookIsGiven(selection) ? selection.books[0] : undefined,
  }),
  // This game type's own rule — see LONE_BOOK_TIERS. The multiplayer
  // equivalent is backend/Domain/GameTypes/Books.fs's scoreGuess.
  scoreGuess: (selection, verse, guess) => tieredPoints(verse, guess, tiersFor(selection)),
  maxPoints: (selection) => maxTieredPoints(tiersFor(selection)),
  sharedColumns: (selection) => (bookIsGiven(selection) ? LONE_BOOK_COLUMNS : ALL_COLUMNS),

  // A name the sender's own source can't resolve (shouldn't happen — the
  // selector only offers names that source returned) is dropped rather
  // than failing the whole game.
  toWire: (selection, booksInBibleOrder) => ({
    Case: 'Books',
    Fields: [
      selection.books
        .map((book) => bookNumberOf(booksInBibleOrder, book))
        .filter((number): number is number => number !== undefined),
    ],
  }),

  // A number the viewer's own source can't resolve (rare — see
  // docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation
  // note) shows as "Book N", so the viewer still sees there's a
  // restriction even if the exact book is a mismatch.
  describeWire: ({ Fields: [bookNumbers] }, booksInBibleOrder) => {
    if (bookNumbers.length === 0) return undefined
    const names = bookNumbers.map((number) => bookAtNumber(booksInBibleOrder, number) ?? `Book ${number}`)
    return `${NAME}: ${names.join(', ')}`
  },

  // Here an unresolvable number is dropped instead: there's no sane tile
  // to offer for a book the viewer's own source doesn't have.
  // The book is given when the WIRE names one book — the same fact the
  // server scores by — whatever the viewer's own Bible could resolve.
  guessConstraintForWire: ({ Fields: [bookNumbers] }, booksInBibleOrder) => {
    const books = bookNumbers
      .map((number) => bookAtNumber(booksInBibleOrder, number))
      .filter((book): book is string => book !== undefined)
    const givenBook = new Set(bookNumbers).size === 1 ? books[0] : undefined
    return { kind: 'one-of-books', books, givenBook }
  },
}
