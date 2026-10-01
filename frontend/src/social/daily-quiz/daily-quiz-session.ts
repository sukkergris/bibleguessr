import type { Guess, Verse } from '../../shared-kernel/bible'
import { standardSingleplayerPoints } from '../../shared-kernel/scoring'
import type { DailyQuiz } from './daily-quiz-client'

/** One answered verse of the quiz. */
export interface DailyQuizRound {
  verse: Verse
  guess: Guess
  points: number
}

/**
 * Where a player is in today's quiz — an explicit state model, so every
 * screen the quiz can show is one case here and every move between them
 * is one function below. Pure: the component (daily-quiz-game.ts) does the
 * fetching and looking up, and feeds the results in.
 */
export type DailyQuizSession =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'playing'
      quiz: DailyQuiz
      roundIndex: number
      /** The current verse's text, once looked up from the player's source. */
      verse: Verse | undefined
      /** Set once the current verse has been answered. */
      feedback: DailyQuizRound | undefined
      /** Every verse answered before the current one. */
      rounds: DailyQuizRound[]
    }
  | { kind: 'finished'; quiz: DailyQuiz; rounds: DailyQuizRound[] }

export const LOADING: DailyQuizSession = { kind: 'loading' }

export function failed(message: string): DailyQuizSession {
  return { kind: 'failed', message }
}

export function started(quiz: DailyQuiz): DailyQuizSession {
  return { kind: 'playing', quiz, roundIndex: 0, verse: undefined, feedback: undefined, rounds: [] }
}

/** The current verse's text has been looked up. A lookup that finishes
 * after the player has already moved on is ignored. */
export function verseResolved(session: DailyQuizSession, roundIndex: number, verse: Verse): DailyQuizSession {
  if (session.kind !== 'playing' || session.roundIndex !== roundIndex) return session
  return { ...session, verse }
}

/** The player guessed the current verse — scored by the standard rules,
 * since the quiz draws from the whole Bible. One guess per verse. */
export function guessed(session: DailyQuizSession, guess: Guess): DailyQuizSession {
  if (session.kind !== 'playing' || !session.verse || session.feedback) return session
  const points = standardSingleplayerPoints(session.verse, guess)
  return { ...session, feedback: { verse: session.verse, guess, points } }
}

/** On to the next verse once the current one is answered — or to the end
 * after the last one. */
export function advanced(session: DailyQuizSession): DailyQuizSession {
  if (session.kind !== 'playing' || !session.feedback) return session
  const rounds = [...session.rounds, session.feedback]
  if (session.roundIndex + 1 >= session.quiz.verses.length) return { kind: 'finished', quiz: session.quiz, rounds }
  return { ...session, roundIndex: session.roundIndex + 1, verse: undefined, feedback: undefined, rounds }
}

export function totalPoints(rounds: DailyQuizRound[]): number {
  return rounds.reduce((sum, round) => sum + round.points, 0)
}
