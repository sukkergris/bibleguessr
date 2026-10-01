import type { Guess, Verse } from './bible'
import { correctParts } from './scoring'

// The shared kernel's result-sharing vocabulary — the one way every share
// in the app (singleplayer results, the daily quiz) is written, so they
// look alike and none can leave out the link. See docs/web/scoring.

/** One verse of a result, as it's shared. */
export type SharedRound =
  | { kind: 'answered'; verse: Verse; guess: Guess; points: number }
  /** Not played — e.g. a daily-quiz verse missing from the player's Bible. */
  | { kind: 'skipped'; points: number }

/** A part of a guess that a shared result can show a mark for. */
export type ResultColumn = 'book' | 'chapter' | 'verseNumber'

/** Every part, in order — what a share shows unless the game type leaves
 * out a part that is given (see GameTypeDefinition.sharedColumns). */
export const ALL_COLUMNS: readonly ResultColumn[] = ['book', 'chapter', 'verseNumber']

const COLUMN_LABELS: Record<ResultColumn, string> = { book: 'Book', chapter: 'Chapter', verseNumber: 'Verse' }
const COLUMN_SEPARATOR = ' · '

/** The header the marks sit under — so they don't rest on colour alone
 * (check and cross also differ in shape). */
export function columnsHeader(columns: readonly ResultColumn[] = ALL_COLUMNS): string {
  return columns.map((column) => COLUMN_LABELS[column]).join(COLUMN_SEPARATOR)
}

export const RESULT_COLUMNS = columnsHeader(ALL_COLUMNS)

/** A part guessed right (green check) or not (red cross). */
const RIGHT = '✅'
const WRONG = '❌'
const SKIPPED = 'skipped'

const DATE_LENGTH = 'yyyy-mm-dd'.length
const TIME_START = DATE_LENGTH + 'T'.length
const TIME_LENGTH = 'hh:mm'.length

/** One verse's line: a mark per column — by which parts were right
 * (correctParts), not by the points, which a game type may weigh
 * differently — then the points. */
export function resultLine(round: SharedRound, columns: readonly ResultColumn[] = ALL_COLUMNS): string {
  if (round.kind === 'skipped') return `${SKIPPED} ${round.points}`
  const parts = correctParts(round.verse, round.guess)
  const marks = columns.map((column) => (parts[column] ? RIGHT : WRONG)).join(' ')
  return `${marks} ${round.points}`
}

/** "Played yyyy-MM-dd HH:mm UTC" — UTC, so it reads the same wherever the
 * person it's shared with is. */
export function playedLine(finishedAtIso: string): string {
  const utc = new Date(finishedAtIso).toISOString()
  return `Played ${utc.slice(0, DATE_LENGTH)} ${utc.slice(TIME_START, TIME_START + TIME_LENGTH)} UTC`
}

/**
 * A whole shared result: `heading` lines, the column header, a line per
 * verse (marks for `columns` only), when it was played, and — always last —
 * `gameUrl`, the address the game is served from (so it follows the
 * environment). Leaves the verses
 * out: a share mustn't give answers away, and verse text never leaves the
 * player's device (see "Data security" in CLAUDE.md).
 */
export function composeShareText(
  heading: string[],
  rounds: SharedRound[],
  finishedAtIso: string,
  gameUrl: string,
  columns: readonly ResultColumn[] = ALL_COLUMNS,
): string {
  return [
    ...heading,
    columnsHeader(columns),
    ...rounds.map((round) => resultLine(round, columns)),
    playedLine(finishedAtIso),
    gameUrl,
  ].join('\n')
}
