// "The Bible" game type: every verse of the Bible is in play, so there is
// nothing to configure. See ../game-type-definition.ts for the rules a
// game type follows.

import { ANY_BOOK } from '../../shared-kernel/guess-constraint'
import type { GameType } from '../../shared-kernel/game-type-wire'
import type { GameTypeDefinition } from '../game-type-definition'

export type TheBibleWire = Extract<GameType, { Case: 'AllVerses' }>

/** The only selection there is: the whole Bible. */
export const WHOLE_BIBLE = { kind: 'whole-bible' } as const
export type TheBibleSelection = typeof WHOLE_BIBLE

const NAME = 'The Bible'

export const theBible: GameTypeDefinition<TheBibleSelection, TheBibleWire> = {
  name: NAME,
  hint: 'quiz on any verse',
  defaultSelection: WHOLE_BIBLE,

  renderSelector: () => undefined,

  verseRestriction: () => undefined,
  guessConstraint: () => ANY_BOOK,

  toWire: () => ({ Case: 'AllVerses' }),
  describeWire: () => NAME,
  guessConstraintForWire: () => ANY_BOOK,
}
