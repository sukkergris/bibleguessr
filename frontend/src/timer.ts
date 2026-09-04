import type { TimeLimit } from './types'

/** How many milliseconds remain until `deadline` (an ISO timestamp), as of
 * `now` (typically Date.now()) — ceil'd up to whole seconds so a countdown
 * never visually shows "expired" a fraction of a second before the server
 * actually resolves the round. Never negative. Undefined `deadline` means
 * no time limit — the caller renders a neutral "no limit" indicator rather
 * than a countdown. */
export function computeRemainingSeconds(deadline: string | undefined, now: number): number | undefined {
  if (!deadline) return undefined
  const remainingMs = new Date(deadline).getTime() - now
  return Math.max(0, Math.ceil(remainingMs / 1000))
}

/** Parses a .NET TimeSpan's default JSON wire format ("00:01:00",
 * "00:00:30.500", optionally with a leading "d." for days) into
 * milliseconds. Only the pieces backend/Domain/Game.fs's TimeLimit
 * actually needs (seconds-to-minutes-scale round limits) are exercised in
 * practice, but the full "[d.]hh:mm:ss[.fffffff]" shape is parsed so this
 * doesn't silently misparse an edge case. */
export function parseTimeSpanMs(timeSpan: string): number {
  const [daysPart, rest] = timeSpan.includes('.') && timeSpan.indexOf('.') < timeSpan.indexOf(':') ? timeSpan.split(/\.(.+)/, 2) : [undefined, timeSpan]
  const [hms, fraction] = rest.split('.')
  const [hours, minutes, seconds] = hms.split(':').map(Number)
  const days = daysPart ? Number(daysPart) : 0
  const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0

  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000 + fractionMs
}

/** Computes the ISO deadline timestamp a round with `roundStartedAt` and
 * `roundTimeLimit` ends at — undefined for Unlimited (no deadline at all).
 * See computeRemainingSeconds for turning this into a live countdown. */
export function deadlineOf(roundStartedAt: string | undefined, roundTimeLimit: TimeLimit): string | undefined {
  if (roundTimeLimit.Case === 'Unlimited' || !roundStartedAt) return undefined
  const [duration] = roundTimeLimit.Fields
  return new Date(new Date(roundStartedAt).getTime() + parseTimeSpanMs(duration)).toISOString()
}
