import { describe, expect, it } from 'vitest'
import { computeRemainingSeconds, deadlineOf, parseTimeSpanMs } from './timer'
import type { TimeLimit } from './types'

describe('computeRemainingSeconds', () => {
  it('returns undefined for an undefined deadline (no time limit)', () => {
    expect(computeRemainingSeconds(undefined, Date.now())).toBeUndefined()
  })

  it('returns the ceil of the remaining milliseconds, in seconds', () => {
    const now = Date.now()
    const deadline = new Date(now + 2500).toISOString()
    expect(computeRemainingSeconds(deadline, now)).toBe(3)
  })

  it('returns 0 once the deadline has passed', () => {
    const now = Date.now()
    const deadline = new Date(now - 1000).toISOString()
    expect(computeRemainingSeconds(deadline, now)).toBe(0)
  })

  it('never returns a negative number', () => {
    const now = Date.now()
    const deadline = new Date(now - 60_000).toISOString()
    expect(computeRemainingSeconds(deadline, now)).toBe(0)
  })
})

describe('parseTimeSpanMs', () => {
  it('parses a plain hh:mm:ss duration', () => {
    expect(parseTimeSpanMs('00:01:00')).toBe(60_000)
  })

  it('parses seconds only', () => {
    expect(parseTimeSpanMs('00:00:30')).toBe(30_000)
  })

  it('parses a fractional-seconds duration', () => {
    expect(parseTimeSpanMs('00:00:30.500')).toBe(30_500)
  })

  it('parses a duration with a leading days component', () => {
    expect(parseTimeSpanMs('1.00:00:00')).toBe(24 * 60 * 60 * 1000)
  })
})

describe('deadlineOf', () => {
  it('returns undefined for Unlimited', () => {
    const unlimited: TimeLimit = { Case: 'Unlimited' }
    expect(deadlineOf(new Date().toISOString(), unlimited)).toBeUndefined()
  })

  it('returns undefined when roundStartedAt is missing', () => {
    const limited: TimeLimit = { Case: 'LimitedTo', Fields: ['00:01:00'] }
    expect(deadlineOf(undefined, limited)).toBeUndefined()
  })

  it('adds the parsed duration to roundStartedAt for LimitedTo', () => {
    const startedAt = new Date('2024-01-01T00:00:00.000Z')
    const limited: TimeLimit = { Case: 'LimitedTo', Fields: ['00:01:00'] }

    const deadline = deadlineOf(startedAt.toISOString(), limited)

    expect(new Date(deadline!).getTime() - startedAt.getTime()).toBe(60_000)
  })
})
