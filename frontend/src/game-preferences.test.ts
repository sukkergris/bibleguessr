import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUND_COUNT,
  MAX_ROUND_COUNT,
  MAX_TIMED_SECONDS,
  MIN_ROUND_COUNT,
  MIN_TIMED_SECONDS,
  parseRoundCount,
  parseTimeLimitSeconds,
} from './game-preferences'

// Stored values are untrusted: they can be hand-edited, left over from an
// older version, or corrupt. None of that may break setup — see
// docs/SCRUM/TODO/Feature.StoreGamersChoiseOfTimeLimitAndRounds.md.

describe('parseRoundCount', () => {
  it('accepts a value inside the allowed range', () => {
    expect(parseRoundCount('7')).toBe(7)
    expect(parseRoundCount(String(MIN_ROUND_COUNT))).toBe(MIN_ROUND_COUNT)
    expect(parseRoundCount(String(MAX_ROUND_COUNT))).toBe(MAX_ROUND_COUNT)
  })

  it('falls back to the default when nothing is stored', () => {
    expect(parseRoundCount(null)).toBe(DEFAULT_ROUND_COUNT)
    expect(parseRoundCount('')).toBe(DEFAULT_ROUND_COUNT)
  })

  it('rejects values outside the allowed range', () => {
    expect(parseRoundCount(String(MIN_ROUND_COUNT - 1))).toBe(DEFAULT_ROUND_COUNT)
    expect(parseRoundCount(String(MAX_ROUND_COUNT + 1))).toBe(DEFAULT_ROUND_COUNT)
    expect(parseRoundCount('-4')).toBe(DEFAULT_ROUND_COUNT)
  })

  it('rejects anything that is not a whole number', () => {
    expect(parseRoundCount('five')).toBe(DEFAULT_ROUND_COUNT)
    expect(parseRoundCount('4.5')).toBe(DEFAULT_ROUND_COUNT)
    expect(parseRoundCount('{"rounds":4}')).toBe(DEFAULT_ROUND_COUNT)
    expect(parseRoundCount('NaN')).toBe(DEFAULT_ROUND_COUNT)
  })
})

describe('parseTimeLimitSeconds', () => {
  it('accepts a value inside the timed range', () => {
    expect(parseTimeLimitSeconds('30')).toBe(30)
    expect(parseTimeLimitSeconds(String(MIN_TIMED_SECONDS))).toBe(MIN_TIMED_SECONDS)
    expect(parseTimeLimitSeconds(String(MAX_TIMED_SECONDS))).toBe(MAX_TIMED_SECONDS)
  })

  it('treats 0 as no time limit', () => {
    expect(parseTimeLimitSeconds('0')).toBeUndefined()
  })

  it('defaults to no time limit when nothing is stored', () => {
    expect(parseTimeLimitSeconds(null)).toBeUndefined()
    expect(parseTimeLimitSeconds('')).toBeUndefined()
  })

  // A one-second round is degenerate and the slider clamps it up to two.
  // A stored 1 should never exist, so it is treated as corrupt rather than
  // quietly clamped — clamping would preserve the bug that wrote it.
  it('rejects a stored one-second round rather than clamping it', () => {
    expect(parseTimeLimitSeconds('1')).toBeUndefined()
  })

  it('rejects values outside the timed range', () => {
    expect(parseTimeLimitSeconds(String(MAX_TIMED_SECONDS + 1))).toBeUndefined()
    expect(parseTimeLimitSeconds('-10')).toBeUndefined()
  })

  it('rejects anything that is not a whole number', () => {
    expect(parseTimeLimitSeconds('thirty')).toBeUndefined()
    expect(parseTimeLimitSeconds('12.5')).toBeUndefined()
  })
})
