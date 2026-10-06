import { api } from './api'

// The one /api/healthz check in the app — see docs/web/connection-status.
// The connection indicator and the nerd panel both subscribe to it, so
// they show the same result and count down to the same next check, and
// the server gets one request per check rather than one per component.

/** Why a check failed. */
export type HealthFailure = { kind: 'timeout' } | { kind: 'status'; code: number } | { kind: 'unreachable' }

/** The latest /api/healthz check. */
export type HealthCheck =
  | { status: 'checking' }
  | { status: 'ok'; latencyMs: number }
  | { status: 'error'; failure: HealthFailure }

/** What every subscriber sees: the latest check, and how long until the
 * next one. */
export interface ServerHealthSnapshot {
  check: HealthCheck
  secondsToNextCheck: number
}

export type HealthListener = (snapshot: ServerHealthSnapshot) => void

/** How often to check while everything looks fine. Long, because a
 * healthy server does not need poking. */
export const HEALTHY_INTERVAL_MS = 15_000

/** How often to check once something looks wrong. A player who has just
 * lost their connection is watching the indicator and wants to know when
 * it comes back — see
 * docs/SCRUM/DONE/Bug.CantTrustConnectionStatusIconRightUpperCorner.md. */
export const UNHEALTHY_INTERVAL_MS = 3_000

/** How long one check may take before it counts as no answer. */
export const CHECK_TIMEOUT_MS = 5_000

/** How often the countdown updates — and whether the next check is due
 * is looked at. One timer for both, restarted whenever the next check is
 * scheduled, so the countdown reaches 0 exactly when the check is due. */
const TICK_MS = 1_000
const MS_PER_SECOND = 1_000
const TIMEOUT_ERROR = 'TimeoutError'
const ABORT_ERROR = 'AbortError'

/** Whole seconds from `now` until `at`, rounded up so it never says 0
 * while there's still time left. Never negative. */
export function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / MS_PER_SECOND))
}

/** A check in words — the same text wherever it's shown. */
export function healthText(check: HealthCheck): string {
  switch (check.status) {
    case 'checking':
      return 'Checking…'
    case 'ok':
      return `OK · ${check.latencyMs} ms`
    case 'error':
      switch (check.failure.kind) {
        case 'timeout':
          return `No answer within ${CHECK_TIMEOUT_MS / MS_PER_SECOND} s`
        case 'status':
          return `Server answered ${check.failure.code}`
        case 'unreachable':
          return 'Could not reach the server'
      }
  }
}

/** The countdown in words, e.g. "in 4 s" — "now" once it's due. */
export function nextCheckText(secondsLeft: number): string {
  return secondsLeft === 0 ? 'now' : `in ${secondsLeft} s`
}

const fetchHealthz = (signal: AbortSignal) => fetch(`${api.baseUrl}/api/healthz`, { cache: 'no-store', signal })

/**
 * Checks /api/healthz while anyone is subscribed: once on the first
 * subscription, then every HEALTHY_INTERVAL_MS — or UNHEALTHY_INTERVAL_MS
 * while the last check failed or a subscriber says something else is
 * wrong (see setUrgent). A new check never starts while one is in flight,
 * except through checkNow.
 *
 * The fetch and the clock are passed in so tests can drive it.
 */
export class ServerHealthMonitor {
  private check: HealthCheck = { status: 'checking' }
  private nextCheckAt = 0
  private urgent = false
  private readonly listeners = new Set<HealthListener>()
  private tickTimer?: ReturnType<typeof setInterval>
  private inFlight?: AbortController

  private readonly fetchHealth: (signal: AbortSignal) => Promise<Response>
  private readonly now: () => number

  constructor(fetchHealth: (signal: AbortSignal) => Promise<Response> = fetchHealthz, now: () => number = Date.now) {
    this.fetchHealth = fetchHealth
    this.now = now
  }

  /** Calls `listener` with every change, and right away with the current
   * state. Returns the unsubscribe function. */
  subscribe(listener: HealthListener): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    else listener(this.snapshot())

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  /** Checks right away, dropping a check still in flight — for when
   * something says the connection just changed (the browser going
   * offline or online). */
  checkNow(): void {
    void this.runCheck()
  }

  /** Whether something the monitor can't see is wrong (no network on the
   * device, a dropped hub connection), so recovery should be noticed
   * quickly too. */
  setUrgent(urgent: boolean): void {
    if (urgent === this.urgent) return
    this.reschedulingIfIntervalChanges(() => (this.urgent = urgent))
    this.notify()
  }

  private start() {
    void this.runCheck()
  }

  private stop() {
    clearInterval(this.tickTimer)
    this.tickTimer = undefined
    this.inFlight?.abort()
    this.inFlight = undefined
  }

  private tick() {
    if (this.now() >= this.nextCheckAt && this.inFlight === undefined) void this.runCheck()
    else this.notify()
  }

  private interval(): number {
    return this.urgent || this.check.status === 'error' ? UNHEALTHY_INTERVAL_MS : HEALTHY_INTERVAL_MS
  }

  /** Applies `change`; if that changes the interval, the next check is
   * one new interval from now. */
  private reschedulingIfIntervalChanges(change: () => void) {
    const before = this.interval()
    change()
    if (this.interval() !== before) this.scheduleNextCheck()
  }

  /** The next check is one interval from now; the countdown ticks from
   * here, so it reaches 0 exactly then. */
  private scheduleNextCheck() {
    this.nextCheckAt = this.now() + this.interval()
    if (this.listeners.size === 0) return
    clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  private async runCheck() {
    this.inFlight?.abort()
    const controller = new AbortController()
    this.inFlight = controller
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Timed out', TIMEOUT_ERROR)),
      CHECK_TIMEOUT_MS,
    )

    const start = this.now()
    this.scheduleNextCheck()
    this.notify()

    let result: HealthCheck
    try {
      const response = await this.fetchHealth(controller.signal)
      result = response.ok
        ? { status: 'ok', latencyMs: Math.round(this.now() - start) }
        : { status: 'error', failure: { kind: 'status', code: response.status } }
    } catch (err) {
      // Dropped on purpose — by a newer check or by the last subscriber
      // leaving. Whatever comes next is what should be shown.
      if (err instanceof DOMException && err.name === ABORT_ERROR) return
      const timedOut = err instanceof DOMException && err.name === TIMEOUT_ERROR
      result = { status: 'error', failure: timedOut ? { kind: 'timeout' } : { kind: 'unreachable' } }
    } finally {
      clearTimeout(timeout)
      if (this.inFlight === controller) this.inFlight = undefined
    }

    this.reschedulingIfIntervalChanges(() => (this.check = result))
    this.notify()
  }

  private snapshot(): ServerHealthSnapshot {
    return { check: this.check, secondsToNextCheck: secondsUntil(this.nextCheckAt, this.now()) }
  }

  private notify() {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

/** The app's one health check. */
export const serverHealth = new ServerHealthMonitor()
