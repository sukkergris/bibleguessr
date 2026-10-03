// "The Bible" game type: every verse of the Bible is in play, so there is
// nothing to configure. See ../game-type-definition.ts for the rules a
// game type follows.

import { ANY_BOOK } from '../../shared-kernel/guess-constraint'
import type { GameType } from '../../shared-kernel/game-type-wire'
import { ALL_COLUMNS } from '../../shared-kernel/result-sharing'
import { STANDARD_TIERS, maxTieredPoints, tieredPoints } from '../../shared-kernel/scoring'
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
  // Nothing is given at setup, so every part earns its standard tier.
  // Change it here to give this game type its own scoring — no other game
  // type is affected. The multiplayer equivalent is
  // backend/Domain/GameTypes/TheBible.fs's scoreGuess.
  scoreGuess: (_selection, verse, guess) => tieredPoints(verse, guess, STANDARD_TIERS),
  maxPoints: () => maxTieredPoints(STANDARD_TIERS),
  sharedColumns: () => ALL_COLUMNS,

  toWire: () => ({ Case: 'AllVerses' }),
  describeWire: () => NAME,
  guessConstraintForWire: () => ANY_BOOK,
}
