import { composeShareText, type SharedRound } from '../../shared-kernel/result-sharing'
import { totalPoints, type DailyQuizRound } from './daily-quiz-session'

/** A finished quiz, as it's shared. */
export interface DailyQuizResult {
  /** The quiz's UTC day, yyyy-MM-dd. */
  quizDate: string
  rounds: DailyQuizRound[]
  /** When it was finished, ISO 8601. */
  finishedAt: string
}

function sharedRound(round: DailyQuizRound): SharedRound {
  return round.kind === 'unavailable' ? { kind: 'skipped', points: round.points } : round
}

/** The text a player shares from the daily quiz's results — see
 * docs/web/daily-quiz. Written like every share in the app (see
 * shared-kernel/result-sharing.ts), headed by the quiz's date and total;
 * `gameUrl` is the address the game is served from. */
export function shareText(result: DailyQuizResult, gameUrl: string): string {
  return composeShareText(
    [`BibleGuessr daily quiz ${result.quizDate}`, `${totalPoints(result.rounds)} points`],
    result.rounds.map(sharedRound),
    result.finishedAt,
    gameUrl,
  )
}
