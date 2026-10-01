// The contract every game type implements — see docs/web/game-types.
//
// Each game type (The Bible, Books, Chapters, ...) is its own bounded
// context in its own folder next to this file. A game type may import only
// from its own folder, from ../shared-kernel, and from this file — never
// from another game type or from the app shell. registry.ts is the one
// place that knows every game type; the rest of the app goes through it.
// architecture.test.ts enforces all of this.

import type { TemplateResult } from 'lit'
import type { Guess, Verse, VerseRestriction, VerseSource } from '../shared-kernel/bible'
import type { GameType } from '../shared-kernel/game-type-wire'
import type { GuessConstraint } from '../shared-kernel/guess-constraint'

/** What a game type's setup UI gets from whichever screen hosts it (the
 * singleplayer setup screen or the multiplayer challenge settings). */
export interface SelectorHost<Selection> {
  verseSource: VerseSource
  translation: string | undefined
  /** A selection made earlier, to restore. */
  selection: Selection | undefined
  /** Called on every change; undefined means "nothing valid picked yet". */
  onChange: (selection: Selection | undefined) => void
}

/**
 * One game type. `Selection` is what the player configures for it, in
 * book NAMES from their own Bible; `Wire` is its case of the shared
 * GameType sent to the server, in book NUMBERS (see
 * ../shared-kernel/book-numbers.ts for why numbers cross the wire).
 */
export interface GameTypeDefinition<Selection, Wire extends GameType> {
  /** Player-facing name, e.g. "Books". */
  readonly name: string
  /** One-line explanation shown under the name on the start screen. */
  readonly hint: string
  /** What a fresh setup starts with — undefined when the player has to
   * pick something before a game can start. */
  readonly defaultSelection: Selection | undefined

  /** The setup UI, or undefined when there is nothing to configure. */
  renderSelector(host: SelectorHost<Selection>): TemplateResult | undefined

  /** Which verses a singleplayer game draws from. */
  verseRestriction(selection: Selection): VerseRestriction | undefined
  /** What the guess form offers during a singleplayer game. */
  guessConstraint(selection: Selection): GuessConstraint
  /** This game type's own singleplayer scoring rule: the points `guess`
   * earns against the round's `verse`. Multiplayer rounds are scored by
   * the server, by the same game type's rule there (see
   * backend/Domain/GameTypes/). */
  scoreGuess(selection: Selection, verse: Verse, guess: Guess): number

  /** The selection as sent to the server, resolved against the sender's
   * own Bible order. */
  toWire(selection: Selection, booksInBibleOrder: string[]): Wire
  /** A short description for the challenged player, in the VIEWER'S own
   * spelling — or undefined when the wire value selects nothing (the
   * registry then describes it as the game it actually plays as). */
  describeWire(wire: Wire, booksInBibleOrder: string[]): string | undefined
  /** What the guess form offers during a multiplayer game, in the
   * viewer's own spelling. */
  guessConstraintForWire(wire: Wire, booksInBibleOrder: string[]): GuessConstraint
}
