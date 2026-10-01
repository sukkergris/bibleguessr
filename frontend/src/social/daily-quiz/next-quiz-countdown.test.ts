import { describe, expect, it } from 'vitest'
import { formatCountdown, secondsUntilNextQuiz, utcDateOf } from './next-quiz-countdown'

describe('secondsUntilNextQuiz', () => {
  it('counts to the next 00:00 UTC', () => {
    expect(secondsUntilNextQuiz(new Date('2026-10-01T23:59:50Z'))).toBe(10)
    expect(secondsUntilNextQuiz(new Date('2026-10-01T12:00:00Z'))).toBe(12 * 60 * 60)
  })

  it('is a whole day at midnight exactly', () => {
    expect(secondsUntilNextQuiz(new Date('2026-10-01T00:00:00Z'))).toBe(24 * 60 * 60)
  })

  it('rounds a part second up, so it never shows 00:00:00 early', () => {
    expect(secondsUntilNextQuiz(new Date('2026-10-01T23:59:59.400Z'))).toBe(1)
  })

  it('goes by UTC, whatever the local time zone says', () => {
    // 01:30 in Copenhagen (UTC+2) is still 23:30 UTC the day before.
    expect(secondsUntilNextQuiz(new Date('2026-10-01T01:30:00+02:00'))).toBe(30 * 60)
  })
})

describe('formatCountdown', () => {
  it('shows hours, minutes and seconds, two digits each', () => {
    expect(formatCountdown(5 * 3600 + 12 * 60 + 3)).toBe('05:12:03')
    expect(formatCountdown(0)).toBe('00:00:00')
    expect(formatCountdown(24 * 3600)).toBe('24:00:00')
  })
})

describe('utcDateOf', () => {
  it('is the UTC day, as the server writes a quiz date', () => {
    expect(utcDateOf(new Date('2026-10-01T23:59:59Z'))).toBe('2026-10-01')
    expect(utcDateOf(new Date('2026-10-02T01:30:00+02:00'))).toBe('2026-10-01')
  })
})

