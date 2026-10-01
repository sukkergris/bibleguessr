// "Books" game type: verses come only from the books the player picked,
// and the guess form offers only those books. See
// ../game-type-definition.ts for the rules a game type follows.

import { html } from 'lit'
import { bookAtNumber, bookNumberOf } from '../../shared-kernel/book-numbers'
import type { GameType } from '../../shared-kernel/game-type-wire'
import { standardSingleplayerPoints } from '../../shared-kernel/scoring'
import type { GameTypeDefinition } from '../game-type-definition'
import './book-selector'

export type BooksWire = Extract<GameType, { Case: 'Books' }>

/** The picked books, in the player's own spelling. Never empty — the
 * selector reports "nothing picked" as undefined instead. */
export interface BooksSelection {
  books: string[]
}

const NAME = 'Books'

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
  guessConstraint: (selection) => ({ kind: 'one-of-books', books: selection.books }),
  // The standard rule today; replace it here to give this game type its
  // own scoring — no other game type is affected.
  scoreGuess: (_selection, verse, guess) => standardSingleplayerPoints(verse, guess),

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
  guessConstraintForWire: ({ Fields: [bookNumbers] }, booksInBibleOrder) => ({
    kind: 'one-of-books',
    books: bookNumbers
      .map((number) => bookAtNumber(booksInBibleOrder, number))
      .filter((book): book is string => book !== undefined),
  }),
}
