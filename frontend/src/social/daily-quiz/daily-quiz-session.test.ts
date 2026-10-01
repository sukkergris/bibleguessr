import { describe, expect, it } from 'vitest'
import type { Verse, VerseReference } from '../../shared-kernel/bible'
import type { DailyQuiz } from './daily-quiz-client'
import { LOADING, advanced, failed, guessed, started, totalPoints, verseResolved } from './daily-quiz-session'

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

const RUT = verseFor(quiz.verses[0])
const JOHANNES = verseFor(quiz.verses[1])

describe('the daily quiz session', () => {
  it('starts on the first verse, waiting for its text', () => {
    expect(started(quiz)).toEqual({ kind: 'playing', quiz, roundIndex: 0, verse: undefined, feedback: undefined, rounds: [] })
  })

  it('shows a verse once its text has been looked up', () => {
    const session = verseResolved(started(quiz), 0, RUT)
    expect(session).toMatchObject({ kind: 'playing', roundIndex: 0, verse: RUT })
  })

  it('ignores a looked-up verse for a round that is no longer current', () => {
    const session = started(quiz)
    expect(verseResolved(session, 1, JOHANNES)).toBe(session)
  })

  it('scores a guess by the standard rules and shows the feedback', () => {
    const session = guessed(verseResolved(started(quiz), 0, RUT), { book: 'Rut', chapter: 1 })
    expect(session).toMatchObject({ kind: 'playing', feedback: { verse: RUT, points: 110 } })
  })

  it('ignores a guess before the verse is shown, or a second guess', () => {
    const waiting = started(quiz)
    expect(guessed(waiting, { book: 'Rut' })).toBe(waiting)

    const answered = guessed(verseResolved(waiting, 0, RUT), { book: 'Rut' })
    expect(guessed(answered, { book: 'Rut', chapter: 1, verseNumber: 16 })).toBe(answered)
  })

  it('moves on to the next verse, keeping the round', () => {
    const session = advanced(guessed(verseResolved(started(quiz), 0, RUT), { book: 'Rut' }))
    expect(session).toMatchObject({ kind: 'playing', roundIndex: 1, verse: undefined, feedback: undefined })
    if (session.kind !== 'playing') throw new Error('expected playing')
    expect(session.rounds.map((round) => round.points)).toEqual([10])
  })

  it('finishes after the last verse, with every round and the total', () => {
    let session = guessed(verseResolved(started(quiz), 0, RUT), { book: 'Rut' })
    session = advanced(session)
    session = guessed(verseResolved(session, 1, JOHANNES), { book: 'Johannes', chapter: 3, verseNumber: 16 })
    session = advanced(session)

    expect(session.kind).toBe('finished')
    if (session.kind !== 'finished') throw new Error('expected finished')
    expect(session.rounds.map((round) => round.points)).toEqual([10, 1110])
    expect(totalPoints(session.rounds)).toBe(1120)
  })

  it('does not move on before the current verse has been answered', () => {
    const session = verseResolved(started(quiz), 0, RUT)
    expect(advanced(session)).toBe(session)
  })

  it('can fail, and starts out loading', () => {
    expect(LOADING).toEqual({ kind: 'loading' })
    expect(failed('No quiz today.')).toEqual({ kind: 'failed', message: 'No quiz today.' })
  })
})
