import type { VerseReference } from '../../shared-kernel/bible'

/** One UTC day's quiz, as the server sends it — see
 * backend/Domain/DailyQuiz.fs and docs/web/daily-quiz. References only;
 * the text of each verse is looked up from the player's own source. */
export interface DailyQuiz {
  /** The UTC day, yyyy-MM-dd. */
  date: string
  /** In the order they're played. */
  verses: VerseReference[]
}

const DAILY_QUIZ_PATH = '/api/daily-quiz'

/** Today's quiz. Social's own small client rather than the app's api.ts,
 * so Social stays standalone (see architecture.test.ts). */
export async function fetchDailyQuiz(): Promise<DailyQuiz> {
  const response = await fetch(DAILY_QUIZ_PATH, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Today's quiz couldn't be loaded (${response.status}).`)
  return (await response.json()) as DailyQuiz
}
