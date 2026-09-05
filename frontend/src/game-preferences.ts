/**
 * The player's remembered round-count and time-limit choices — see
 * docs/SCRUM/TODO/Feature.StoreGamersChoiseOfTimeLimitAndRounds.md.
 *
 * These are preferences for *creating* a game, local to this browser. They
 * are never uploaded merely because they are remembered, and they are not
 * the settings of a game already in progress: once a game starts, its own
 * session fixes those values and later changes here cannot affect it.
 *
 * Every read is validated rather than trusted. Storage can be edited by
 * hand, left over from an older version, or corrupt, and none of that
 * should be able to break the setup screen — an unusable stored value is
 * simply replaced by the default.
 */

const ROUND_COUNT_KEY = 'bibleguessr:preferences:roundCount:v1'
const TIME_LIMIT_KEY = 'bibleguessr:preferences:timeLimitSeconds:v1'

export const DEFAULT_ROUND_COUNT = 5
export const MIN_ROUND_COUNT = 3
export const MAX_ROUND_COUNT = 10

/** The shortest genuinely playable timed round. The slider has a notch at
 * 1 second that is clamped up to this, and a one-second round must never
 * be persisted as if it were usable. */
export const MIN_TIMED_SECONDS = 2
export const MAX_TIMED_SECONDS = 60

/** `undefined` means no time limit — the same vocabulary the setup
 * controls and the domain already use. At the storage boundary that is
 * written as 0. */
export type TimeLimitPreference = number | undefined

const UNLIMITED_STORED = 0

/** Narrows an arbitrary stored string to a usable round count. */
export function parseRoundCount(raw: string | null): number {
  const value = Number(raw)
  if (raw === null || raw.trim() === '' || !Number.isInteger(value)) return DEFAULT_ROUND_COUNT
  if (value < MIN_ROUND_COUNT || value > MAX_ROUND_COUNT) return DEFAULT_ROUND_COUNT
  return value
}

/** Narrows an arbitrary stored string to a usable time limit.
 *
 * A stored 1 is treated as the unusable value it is and falls back to the
 * default rather than being clamped up: it should never have been written,
 * so trusting it would preserve a bug rather than recover from one. */
export function parseTimeLimitSeconds(raw: string | null): TimeLimitPreference {
  const value = Number(raw)
  if (raw === null || raw.trim() === '' || !Number.isInteger(value)) return undefined
  if (value === UNLIMITED_STORED) return undefined
  if (value < MIN_TIMED_SECONDS || value > MAX_TIMED_SECONDS) return undefined
  return value
}

/** Reads the remembered round count, falling back to the default for
 * missing, malformed or out-of-range values — and when storage itself is
 * unavailable, as in private browsing. */
export function loadRoundCount(): number {
  try {
    return parseRoundCount(localStorage.getItem(ROUND_COUNT_KEY))
  } catch {
    return DEFAULT_ROUND_COUNT
  }
}

/** Reads the remembered time limit; `undefined` means no limit. */
export function loadTimeLimitSeconds(): TimeLimitPreference {
  try {
    return parseTimeLimitSeconds(localStorage.getItem(TIME_LIMIT_KEY))
  } catch {
    return undefined
  }
}

/** Remembers a round count. Values outside the valid range are not written
 * at all, so storage can never be the source of an invalid setup. */
export function saveRoundCount(value: number): void {
  if (!Number.isInteger(value) || value < MIN_ROUND_COUNT || value > MAX_ROUND_COUNT) return
  try {
    localStorage.setItem(ROUND_COUNT_KEY, String(value))
  } catch {
    // Storage unavailable — the choice simply isn't remembered, which is
    // never worth failing setup over.
  }
}

/** Remembers a time limit, writing `undefined` as the unlimited sentinel. */
export function saveTimeLimitSeconds(value: TimeLimitPreference): void {
  if (value !== undefined && (!Number.isInteger(value) || value < MIN_TIMED_SECONDS || value > MAX_TIMED_SECONDS)) {
    return
  }
  try {
    localStorage.setItem(TIME_LIMIT_KEY, String(value ?? UNLIMITED_STORED))
  } catch {
    // See saveRoundCount.
  }
}
