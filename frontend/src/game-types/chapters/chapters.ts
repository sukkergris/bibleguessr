// "Chapters" game type: the player commits to one book and picks some of
// its chapters. Verses come only from those chapters; the guess form
// shows the book as fixed and offers only those chapters. See
// ../game-type-definition.ts for the rules a game type follows.

import { html } from 'lit'
import { bookAtNumber, bookNumberOf } from '../../shared-kernel/book-numbers'
import type { GameType } from '../../shared-kernel/game-type-wire'
import { ANY_BOOK } from '../../shared-kernel/guess-constraint'
import type { ResultColumn } from '../../shared-kernel/result-sharing'
import { STANDARD_TIERS, tieredPoints } from '../../shared-kernel/scoring'
import type { GameTypeDefinition } from '../game-type-definition'
import './chapter-selector'

export type ChaptersWire = Extract<GameType, { Case: 'Chapters' }>

/** The one picked book, in the player's own spelling, and its picked
 * chapters in ascending order. Never has an empty `chapters` — the
 * selector reports "nothing picked" as undefined instead. */
export interface ChaptersSelection {
  book: string
  chapters: number[]
}

const NAME = 'Chapters'

const ascending = (a: number, b: number) => a - b

/** What's given at setup is no achievement, so it earns nothing: the
 * book always is (it's fixed). Chapter and verse keep the standard
 * points... */
const CHAPTERS_TIERS = { ...STANDARD_TIERS, book: 0 }

/** ...unless only one chapter was picked: then the chapter is a given
 * too, and only the verse is left to earn points for. */
const LONE_CHAPTER_TIERS = { ...CHAPTERS_TIERS, chapter: 0 }

/** The same given parts left out of a shared result, where they'd always
 * show ✅. */
const CHAPTERS_COLUMNS: readonly ResultColumn[] = ['chapter', 'verseNumber']
const LONE_CHAPTER_COLUMNS: readonly ResultColumn[] = ['verseNumber']

/** The wire format allows several books; this game type only ever sends
 * one, so the first is the one it's about. */
function firstEntry(wire: ChaptersWire): [bookNumber: number, chapters: number[]] | undefined {
  const [chaptersByBookNumber] = wire.Fields
  const [first] = Object.keys(chaptersByBookNumber).map(Number)
  return first === undefined ? undefined : [first, chaptersByBookNumber[first]]
}

export const chapters: GameTypeDefinition<ChaptersSelection, ChaptersWire> = {
  name: NAME,
  hint: 'choose chapters in one book',
  defaultSelection: undefined,

  renderSelector: (host) => html`
    <bg-chapter-selector
      .verseSource=${host.verseSource}
      .translation=${host.translation}
      .initialSelection=${host.selection}
      @chapters-selection-changed=${(event: CustomEvent<ChaptersSelection | undefined>) => host.onChange(event.detail)}
    ></bg-chapter-selector>
  `,

  verseRestriction: (selection) => ({
    books: [selection.book],
    chaptersByBook: { [selection.book]: selection.chapters },
  }),
  guessConstraint: (selection) => ({ kind: 'fixed-book', book: selection.book, chapters: selection.chapters }),
  // This game type's own rule — see CHAPTERS_TIERS. The multiplayer
  // equivalent is backend/Domain/GameTypes/Chapters.fs's scoreGuess.
  scoreGuess: (selection, verse, guess) =>
    tieredPoints(verse, guess, selection.chapters.length === 1 ? LONE_CHAPTER_TIERS : CHAPTERS_TIERS),
  sharedColumns: (selection) => (selection.chapters.length === 1 ? LONE_CHAPTER_COLUMNS : CHAPTERS_COLUMNS),

  toWire: (selection, booksInBibleOrder) => {
    const number = bookNumberOf(booksInBibleOrder, selection.book)
    return { Case: 'Chapters', Fields: [number === undefined ? {} : { [number]: selection.chapters }] }
  },

  describeWire: ({ Fields: [chaptersByBookNumber] }, booksInBibleOrder) => {
    const parts = Object.entries(chaptersByBookNumber).map(([bookNumber, bookChapters]) => {
      const name = bookAtNumber(booksInBibleOrder, Number(bookNumber)) ?? `Book ${bookNumber}`
      return `${name} ${[...bookChapters].sort(ascending).join(', ')}`
    })
    return parts.length === 0 ? undefined : `${NAME}: ${parts.join('; ')}`
  },

  // A book the viewer's own source can't resolve can't be shown as the
  // fixed book, so the guess form falls back to offering every book.
  guessConstraintForWire: (wire, booksInBibleOrder) => {
    const entry = firstEntry(wire)
    const book = entry && bookAtNumber(booksInBibleOrder, entry[0])
    return entry && book ? { kind: 'fixed-book', book, chapters: entry[1] } : ANY_BOOK
  },
}
