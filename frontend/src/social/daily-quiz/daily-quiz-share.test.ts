import { describe, expect, it } from 'vitest'
import { RESULT_COLUMNS } from '../../shared-kernel/result-sharing'
import type { DailyQuizRound } from './daily-quiz-session'
import { shareText } from './daily-quiz-share'

const verse = { book: 'Rut', chapter: 1, verseNumber: 16, text: 'secret text', translation: 'Test', reference: 'Rut 1:16' }

const rounds: DailyQuizRound[] = [
  { kind: 'answered', verse, guess: { book: 'Rut', chapter: 1, verseNumber: 16 }, points: 1110 },
  { kind: 'answered', verse, guess: { book: 'Rut' }, points: 10 },
  { kind: 'unavailable', reference: { book: 'Rut', bookNumber: 8, chapter: 1, verseNumber: 16 }, points: 0 },
]

const result = { quizDate: '2026-10-01', rounds, finishedAt: '2026-10-01T14:32:09.000Z' }
const GAME_URL = 'https://www.bibleguessr.single/'

describe('shareText', () => {
  it('names the quiz by its date and gives the total', () => {
    const lines = shareText(result, GAME_URL).split('\n')
    expect(lines.slice(0, 2)).toEqual(['BibleGuessr daily quiz 2026-10-01', '1120 points'])
  })

  it('shows, verse by verse, which parts were right — a verse missing from the player’s Bible as skipped', () => {
    const lines = shareText(result, GAME_URL).split('\n')
    const header = lines.indexOf(RESULT_COLUMNS)
    expect(lines.slice(header + 1, header + 4)).toEqual(['✅ ✅ ✅ 1110', '✅ ❌ ❌ 10', 'skipped 0'])
  })

  it('says when it was played and links to BibleGuessr', () => {
    const lines = shareText(result, GAME_URL).split('\n')
    expect(lines).toContain('Played 2026-10-01 14:32 UTC')
    expect(lines.at(-1)).toBe(GAME_URL)
  })

  it('gives away neither the verses nor their text', () => {
    expect(shareText(result, GAME_URL)).not.toContain('Rut')
    expect(shareText(result, GAME_URL)).not.toContain('secret text')
  })
})
