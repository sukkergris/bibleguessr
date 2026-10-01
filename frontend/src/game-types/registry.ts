// The one place that knows every game type — see docs/web/game-types.
// The app shell asks this module, never a game type directly and never
// by branching on which type is in play; the game types themselves never
// see each other (enforced by architecture.test.ts).
//
// Adding a game type: give it its own folder implementing
// GameTypeDefinition, then add it to SelectionById, WireById,
// DEFINITIONS, GAME_TYPE_IDS and definitionForWire below — the compiler
// points out anything missed.

import type { TemplateResult } from 'lit'
import type { Guess, Verse, VerseRestriction, VerseSource } from '../shared-kernel/bible'
import type { GameType } from '../shared-kernel/game-type-wire'
import type { GuessConstraint } from '../shared-kernel/guess-constraint'
import type { ResultColumn } from '../shared-kernel/result-sharing'
import { books, type BooksSelection, type BooksWire } from './books/books'
import { chapters, type ChaptersSelection, type ChaptersWire } from './chapters/chapters'
import type { GameTypeDefinition } from './game-type-definition'
import { theBible, WHOLE_BIBLE, type TheBibleSelection, type TheBibleWire } from './the-bible/the-bible'

export type GameTypeId = 'the-bible' | 'books' | 'chapters'

interface SelectionById {
  'the-bible': TheBibleSelection
  books: BooksSelection
  chapters: ChaptersSelection
}

interface WireById {
  'the-bible': TheBibleWire
  books: BooksWire
  chapters: ChaptersWire
}

type DefinitionFor<K extends GameTypeId> = GameTypeDefinition<SelectionById[K], WireById[K]>

const DEFINITIONS: { [K in GameTypeId]: DefinitionFor<K> } = {
  'the-bible': theBible,
  books,
  chapters,
}

/** Every game type, in the order the player is offered them. */
export const GAME_TYPE_IDS: readonly GameTypeId[] = ['the-bible', 'books', 'chapters']

/** Which game type the player is configuring, and what they have picked
 * for it so far — undefined until they've picked something valid. */
export type GameTypeChoice<K extends GameTypeId = GameTypeId> = {
  [P in K]: { gameType: P; selection: SelectionById[P] | undefined }
}[K]

/** The game every game type plays as while nothing is picked for it —
 * e.g. a multiplayer challenge sent from the Books tab before any book is
 * ticked. */
const FALLBACK: GameTypeChoice<'the-bible'> = { gameType: 'the-bible', selection: WHOLE_BIBLE }

export function nameOf(gameType: GameTypeId): string {
  return DEFINITIONS[gameType].name
}

export function hintOf(gameType: GameTypeId): string {
  return DEFINITIONS[gameType].hint
}

/** A choice as a fresh setup screen starts it. */
export function freshChoice<K extends GameTypeId>(gameType: K): GameTypeChoice<K> {
  const definition: DefinitionFor<K> = DEFINITIONS[gameType]
  return { gameType, selection: definition.defaultSelection } as GameTypeChoice<K>
}

/** Whether a game can start with this choice. */
export function isReady(choice: GameTypeChoice): boolean {
  return choice.selection !== undefined
}

/** Calls `use` with the choice's own definition and selection, so the
 * pairing stays type-checked without a switch per operation. */
function withDefinition<K extends GameTypeId, R>(
  choice: GameTypeChoice<K>,
  use: (definition: DefinitionFor<K>, selection: SelectionById[K] | undefined) => R,
): R {
  return use(DEFINITIONS[choice.gameType] as DefinitionFor<K>, choice.selection as SelectionById[K] | undefined)
}

/** The setup UI for the choice's game type, or undefined when it has
 * nothing to configure. `onChange` receives the updated choice. */
export function renderSelector<K extends GameTypeId>(
  choice: GameTypeChoice<K>,
  host: { verseSource: VerseSource; translation: string | undefined; onChange: (choice: GameTypeChoice<K>) => void },
): TemplateResult | undefined {
  return withDefinition(choice, (definition, selection) =>
    definition.renderSelector({
      verseSource: host.verseSource,
      translation: host.translation,
      selection,
      onChange: (next) => host.onChange({ gameType: choice.gameType, selection: next } as GameTypeChoice<K>),
    }),
  )
}

/** Which verses a singleplayer game with this choice draws from. */
export function verseRestrictionOf(choice: GameTypeChoice): VerseRestriction | undefined {
  return withDefinition(choice, (definition, selection) =>
    selection === undefined ? undefined : definition.verseRestriction(selection),
  )
}

/** What the guess form offers in a singleplayer game with this choice. */
export function guessConstraintOf(choice: GameTypeChoice): GuessConstraint {
  return withDefinition(choice, (definition, selection) =>
    selection === undefined ? theBible.guessConstraint(WHOLE_BIBLE) : definition.guessConstraint(selection),
  )
}

/** The points `guess` earns against `verse` in a singleplayer game with
 * this choice — by the choice's own game type's rule. A choice with
 * nothing picked plays, and so scores, as FALLBACK. */
export function scoreGuessOf(choice: GameTypeChoice, verse: Verse, guess: Guess): number {
  const playable: GameTypeChoice = isReady(choice) ? choice : FALLBACK
  return withDefinition(playable, (definition, selection) => definition.scoreGuess(selection!, verse, guess))
}

/** Which parts of each verse a shared result of this choice shows — by
 * the choice's own game type. Nothing picked plays as FALLBACK. */
export function sharedColumnsOf(choice: GameTypeChoice): readonly ResultColumn[] {
  const playable: GameTypeChoice = isReady(choice) ? choice : FALLBACK
  return withDefinition(playable, (definition, selection) => definition.sharedColumns(selection!))
}

/** The choice as sent with a play request or matchmaking entry, resolved
 * against the sender's own Bible order. Nothing picked yet plays as
 * FALLBACK. */
export async function toWire(
  choice: GameTypeChoice,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<GameType> {
  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  const playable: GameTypeChoice = isReady(choice) ? choice : FALLBACK
  return withDefinition(playable, (definition, selection) => definition.toWire(selection!, booksInBibleOrder))
}

/** Dispatches on the wire case — the inverse of each definition's
 * toWire. */
function definitionForWire<R>(
  wire: GameType,
  use: <K extends GameTypeId>(definition: DefinitionFor<K>, wire: WireById[K]) => R,
): R {
  switch (wire.Case) {
    case 'AllVerses':
      return use<'the-bible'>(theBible, wire)
    case 'Books':
      return use<'books'>(books, wire)
    case 'Chapters':
      return use<'chapters'>(chapters, wire)
  }
}

/** A short description of a received game type, in the VIEWER'S own
 * spelling (`verseSource` is the viewer's, not the sender's). One that
 * selects nothing reads as the game it plays as. */
export async function describeWire(
  wire: GameType,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<string> {
  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  return (
    definitionForWire(wire, (definition, ownWire) => definition.describeWire(ownWire, booksInBibleOrder)) ??
    theBible.describeWire({ Case: 'AllVerses' }, booksInBibleOrder)!
  )
}

/** What the guess form offers in a multiplayer game of this type, in the
 * viewer's own spelling. */
export async function guessConstraintForWire(
  wire: GameType,
  verseSource: VerseSource,
  translation: string | undefined,
): Promise<GuessConstraint> {
  const booksInBibleOrder = await verseSource.getBooksInBibleOrder(translation)
  return definitionForWire(wire, (definition, ownWire) => definition.guessConstraintForWire(ownWire, booksInBibleOrder))
}
