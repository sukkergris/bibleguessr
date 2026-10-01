import type { Guess, Verse, VerseReference } from '../../shared-kernel/bible'
import { standardSingleplayerPoints } from '../../shared-kernel/scoring'
import type { DailyQuiz } from './daily-quiz-client'

/** One finished verse of the quiz: answered, or skipped because the
 * player's own Bible doesn't have it. */
export type DailyQuizRound =
  | { kind: 'answered'; verse: Verse; guess: Guess; points: number }
  | { kind: 'unavailable'; reference: VerseReference; points: 0 }

/** The current verse while it's being played. */
export type CurrentVerse =
  | { kind: 'looking-up' }
  | { kind: 'shown'; verse: Verse }
  /** The player's own Bible doesn't have it (a different verse
   * numbering, a book left out) — it can be skipped. */
  | { kind: 'unavailable' }

/**
 * Where a player is in today's quiz — an explicit state model, so every
 * screen the quiz can show is one case here and every move between them
 * is one function below. Pure: the component (daily-quiz-game.ts) does the
 * choosing, fetching and looking up, and feeds the results in.
 */
export type DailyQuizSession =
  /** Picking which Bible to play from — a server translation or the
   * player's own file. */
  | { kind: 'choosing-bible' }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'playing'
      quiz: DailyQuiz
      roundIndex: number
      current: CurrentVerse
      /** Set once the current verse has been answered or skipped. */
      feedback: DailyQuizRound | undefined
      /** Every verse finished before the current one. */
      rounds: DailyQuizRound[]
    }
  | {
      kind: 'finished'
      quiz: DailyQuiz
      rounds: DailyQuizRound[]
      /** When the last verse was finished (ISO 8601) — for the shared result. */
      finishedAt: string
    }

export const CHOOSING_BIBLE: DailyQuizSession = { kind: 'choosing-bible' }

export const LOADING: DailyQuizSession = { kind: 'loading' }

export function failed(message: string): DailyQuizSession {
  return { kind: 'failed', message }
}

export function started(quiz: DailyQuiz): DailyQuizSession {
  return { kind: 'playing', quiz, roundIndex: 0, current: { kind: 'looking-up' }, feedback: undefined, rounds: [] }
}

const isLookingUp = (session: DailyQuizSession, roundIndex: number) =>
  session.kind === 'playing' && session.roundIndex === roundIndex && session.current.kind === 'looking-up'

/** The current verse's text has been looked up. A lookup that finishes
 * after the player has already moved on is ignored. */
export function verseResolved(session: DailyQuizSession, roundIndex: number, verse: Verse): DailyQuizSession {
  if (!isLookingUp(session, roundIndex) || session.kind !== 'playing') return session
  return { ...session, current: { kind: 'shown', verse } }
}

/** The player's Bible doesn't have the current verse. */
export function verseUnavailable(session: DailyQuizSession, roundIndex: number): DailyQuizSession {
  if (!isLookingUp(session, roundIndex) || session.kind !== 'playing') return session
  return { ...session, current: { kind: 'unavailable' } }
}

/** The player guessed the current verse — scored by the standard rules,
 * since the quiz draws from the whole Bible. One guess per verse. */
export function guessed(session: DailyQuizSession, guess: Guess): DailyQuizSession {
  if (session.kind !== 'playing' || session.current.kind !== 'shown' || session.feedback) return session
  const { verse } = session.current
  const points = standardSingleplayerPoints(verse, guess)
  return { ...session, feedback: { kind: 'answered', verse, guess, points } }
}

/** The player skips a verse their Bible doesn't have — for no points. */
export function skipped(session: DailyQuizSession): DailyQuizSession {
  if (session.kind !== 'playing' || session.current.kind !== 'unavailable' || session.feedback) return session
  const reference = session.quiz.verses[session.roundIndex]
  return { ...session, feedback: { kind: 'unavailable', reference, points: 0 } }
}

/** On to the next verse once the current one is finished — or to the end
 * after the last one, at `now` (passed in, so this stays pure). */
export function advanced(session: DailyQuizSession, now: Date): DailyQuizSession {
  if (session.kind !== 'playing' || !session.feedback) return session
  const rounds = [...session.rounds, session.feedback]
  if (session.roundIndex + 1 >= session.quiz.verses.length) {
    return { kind: 'finished', quiz: session.quiz, rounds, finishedAt: now.toISOString() }
  }
  return { ...session, roundIndex: session.roundIndex + 1, current: { kind: 'looking-up' }, feedback: undefined, rounds }
}

export function totalPoints(rounds: DailyQuizRound[]): number {
  return rounds.reduce((sum, round) => sum + round.points, 0)
}
