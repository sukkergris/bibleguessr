import { describe, expect, it } from 'vitest'
import type { Verse, VerseReference } from '../../shared-kernel/bible'
import type { DailyQuiz } from './daily-quiz-client'
import {
  CHOOSING_BIBLE,
  LOADING,
  advanced,
  failed,
  guessed,
  skipped,
  started,
  totalPoints,
  verseResolved,
  verseUnavailable,
} from './daily-quiz-session'

const reference = (book: string, bookNumber: number, chapter: number, verseNumber: number): VerseReference => ({
  book,
  bookNumber,
  chapter,
  verseNumber,
})

const quiz: DailyQuiz = {
  date: '2026-10-01',
  verses: [reference('Rut', 8, 1, 16), reference('Johannes', 43, 3, 16)],
}

const verseFor = (r: VerseReference): Verse => ({
  book: r.book,
  chapter: r.chapter,
  verseNumber: r.verseNumber,
  text: 'not used',
  translation: 'Test',
  reference: `${r.book} ${r.chapter}:${r.verseNumber}`,
})

const NOW = new Date('2026-10-01T14:32:09Z')

const RUT = verseFor(quiz.verses[0])
const JOHANNES = verseFor(quiz.verses[1])

describe('the daily quiz session', () => {
  it('begins with choosing a Bible, then loads', () => {
    expect(CHOOSING_BIBLE).toEqual({ kind: 'choosing-bible' })
    expect(LOADING).toEqual({ kind: 'loading' })
  })

  it('starts on the first verse, looking up its text', () => {
    expect(started(quiz)).toEqual({
      kind: 'playing',
      quiz,
      roundIndex: 0,
      current: { kind: 'looking-up' },
      feedback: undefined,
      rounds: [],
    })
  })

  it('shows a verse once its text has been looked up', () => {
    expect(verseResolved(started(quiz), 0, RUT)).toMatchObject({ current: { kind: 'shown', verse: RUT } })
  })

  it('ignores a lookup for a round that is no longer current', () => {
    const session = started(quiz)
    expect(verseResolved(session, 1, JOHANNES)).toBe(session)
    expect(verseUnavailable(session, 1)).toBe(session)
  })

  it('scores a guess by the standard rules and shows the feedback', () => {
    const session = guessed(verseResolved(started(quiz), 0, RUT), { book: 'Rut', chapter: 1 })
    expect(session).toMatchObject({ feedback: { kind: 'answered', verse: RUT, points: 110 } })
  })

  it('ignores a guess before the verse is shown, or a second guess', () => {
    const waiting = started(quiz)
    expect(guessed(waiting, { book: 'Rut' })).toBe(waiting)

    const answered = guessed(verseResolved(waiting, 0, RUT), { book: 'Rut' })
    expect(guessed(answered, { book: 'Rut', chapter: 1, verseNumber: 16 })).toBe(answered)
  })

  // The player's own Bible may lack a verse the quiz has (a different
  // verse numbering, a book left out): that verse can be skipped, for no
  // points, instead of the whole quiz failing.
  it('lets a verse missing from the player’s Bible be skipped, for no points', () => {
    const missing = verseUnavailable(started(quiz), 0)
    expect(missing).toMatchObject({ current: { kind: 'unavailable' } })
    expect(guessed(missing, { book: 'Rut' })).toBe(missing)

    const session = skipped(missing)
    expect(session).toMatchObject({ feedback: { kind: 'unavailable', reference: quiz.verses[0], points: 0 } })
  })

  it('only skips a verse that is missing', () => {
    const shown = verseResolved(started(quiz), 0, RUT)
    expect(skipped(shown)).toBe(shown)
  })

  it('moves on to the next verse, keeping the round', () => {
    const session = advanced(guessed(verseResolved(started(quiz), 0, RUT), { book: 'Rut' }), NOW)
    expect(session).toMatchObject({ kind: 'playing', roundIndex: 1, current: { kind: 'looking-up' }, feedback: undefined })
    if (session.kind !== 'playing') throw new Error('expected playing')
    expect(session.rounds.map((round) => round.points)).toEqual([10])
  })

  it('finishes after the last verse, with every round and the total', () => {
    let session = skipped(verseUnavailable(started(quiz), 0))
    session = advanced(session, NOW)
    session = guessed(verseResolved(session, 1, JOHANNES), { book: 'Johannes', chapter: 3, verseNumber: 16 })
    session = advanced(session, NOW)

    expect(session.kind).toBe('finished')
    if (session.kind !== 'finished') throw new Error('expected finished')
    // When it was finished — for the shared result.
    expect(session.finishedAt).toBe(NOW.toISOString())
    expect(session.rounds.map((round) => round.kind)).toEqual(['unavailable', 'answered'])
    expect(totalPoints(session.rounds)).toBe(1110)
  })

  it('does not move on before the current verse has been answered', () => {
    const session = verseResolved(started(quiz), 0, RUT)
    expect(advanced(session, NOW)).toBe(session)
  })

  it('can fail', () => {
    expect(failed('No quiz today.')).toEqual({ kind: 'failed', message: 'No quiz today.' })
  })
})
