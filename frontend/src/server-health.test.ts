import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHECK_TIMEOUT_MS,
  HEALTHY_INTERVAL_MS,
  UNHEALTHY_INTERVAL_MS,
  ServerHealthMonitor,
  healthText,
  nextCheckText,
  secondsUntil,
  type ServerHealthSnapshot,
} from './server-health'

// The app's one /api/healthz check — see server-health.ts and
// docs/web/connection-status. Fake timers drive the clock; the fetch is a
// stub that answers however each test needs.

/** A stub fetch: answers every request with `respond()`'s response, after
 * `delayMs`, and rejects like the real fetch when its signal aborts. */
function stubFetch(respond: () => Response | 'network-error', delayMs = 10) {
  const calls: AbortSignal[] = []
  const fetchHealth = (signal: AbortSignal) => {
    calls.push(signal)
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        const answer = respond()
        if (answer === 'network-error') reject(new TypeError('Failed to fetch'))
        else resolve(answer)
      }, delayMs)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason)
      })
    })
  }
  return { fetchHealth, calls }
}

const ok = () => new Response(null, { status: 200 })
const unavailable = () => new Response(null, { status: 503 })

function subscribed(monitor: ServerHealthMonitor) {
  const seen: ServerHealthSnapshot[] = []
  const unsubscribe = monitor.subscribe((snapshot) => seen.push(snapshot))
  return { latest: () => seen.at(-1)!, unsubscribe }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ServerHealthMonitor', () => {
  it('checks as soon as someone subscribes', async () => {
    const { fetchHealth, calls } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)

    const { latest } = subscribed(monitor)
    expect(calls).toHaveLength(1)
    expect(latest().check).toEqual({ status: 'checking' })

    await vi.advanceTimersByTimeAsync(10)
    expect(latest().check).toEqual({ status: 'ok', latencyMs: 10 })
  })

  it('shares one check between every subscriber', async () => {
    const { fetchHealth, calls } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)

    const first = subscribed(monitor)
    const second = subscribed(monitor)
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS + 100)

    expect(calls).toHaveLength(2) // on subscribing, then once the interval ran out
    expect(second.latest()).toEqual(first.latest())
  })

  it('a later subscriber gets the current state straight away', async () => {
    const { fetchHealth } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const first = subscribed(monitor)
    await vi.advanceTimersByTimeAsync(10)

    const second = subscribed(monitor)
    expect(second.latest()).toEqual(first.latest())
  })

  it('counts down to the next check, and checks when it runs out', async () => {
    const { fetchHealth, calls } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const { latest } = subscribed(monitor)
    await vi.advanceTimersByTimeAsync(10)
    expect(latest().secondsToNextCheck).toBe(HEALTHY_INTERVAL_MS / 1000)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(latest().secondsToNextCheck).toBe(HEALTHY_INTERVAL_MS / 1000 - 1)
    expect(calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS)
    expect(calls).toHaveLength(2)
  })

  it('checks more often while the last check failed', async () => {
    const { fetchHealth, calls } = stubFetch(unavailable)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const { latest } = subscribed(monitor)
    await vi.advanceTimersByTimeAsync(10)

    expect(latest().check).toEqual({ status: 'error', failure: { kind: 'status', code: 503 } })
    expect(latest().secondsToNextCheck).toBe(UNHEALTHY_INTERVAL_MS / 1000)

    await vi.advanceTimersByTimeAsync(UNHEALTHY_INTERVAL_MS + 100)
    expect(calls).toHaveLength(2)
  })

  it('checks more often while a subscriber says something else is wrong', async () => {
    const { fetchHealth, calls } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const { latest } = subscribed(monitor)
    await vi.advanceTimersByTimeAsync(10)

    monitor.setUrgent(true)
    expect(latest().secondsToNextCheck).toBe(UNHEALTHY_INTERVAL_MS / 1000)
    await vi.advanceTimersByTimeAsync(UNHEALTHY_INTERVAL_MS + 100)
    expect(calls).toHaveLength(2)

    monitor.setUrgent(false)
    expect(latest().secondsToNextCheck).toBe(HEALTHY_INTERVAL_MS / 1000)
  })

  it('reports a check with no answer in time as a timeout', async () => {
    const { fetchHealth } = stubFetch(ok, CHECK_TIMEOUT_MS * 2)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const { latest } = subscribed(monitor)

    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS)
    expect(latest().check).toEqual({ status: 'error', failure: { kind: 'timeout' } })
  })

  it('does not start a new check while one is still waiting for an answer', async () => {
    // Slower than the unhealthy interval but inside the timeout: starting
    // the next check on schedule would cancel this one every time, and a
    // hanging server would never be reported as one.
    const { fetchHealth, calls } = stubFetch(ok, UNHEALTHY_INTERVAL_MS + 1_000)
    const monitor = new ServerHealthMonitor(fetchHealth)
    subscribed(monitor)
    monitor.setUrgent(true)

    await vi.advanceTimersByTimeAsync(UNHEALTHY_INTERVAL_MS + 500)
    expect(calls).toHaveLength(1)
    expect(calls[0].aborted).toBe(false)
  })

  it('reports a network failure as unreachable', async () => {
    const { fetchHealth } = stubFetch(() => 'network-error')
    const monitor = new ServerHealthMonitor(fetchHealth)
    const { latest } = subscribed(monitor)

    await vi.advanceTimersByTimeAsync(10)
    expect(latest().check).toEqual({ status: 'error', failure: { kind: 'unreachable' } })
  })

  it('checkNow checks right away and starts the countdown over', async () => {
    const { fetchHealth, calls } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const { latest } = subscribed(monitor)
    await vi.advanceTimersByTimeAsync(5_000)

    monitor.checkNow()
    expect(calls).toHaveLength(2)
    expect(latest().secondsToNextCheck).toBe(HEALTHY_INTERVAL_MS / 1000)
  })

  it('stops checking when the last subscriber leaves', async () => {
    const { fetchHealth, calls } = stubFetch(ok)
    const monitor = new ServerHealthMonitor(fetchHealth)
    const first = subscribed(monitor)
    const second = subscribed(monitor)

    first.unsubscribe()
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS + 100)
    expect(calls).toHaveLength(2) // still one subscriber

    second.unsubscribe()
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS * 2)
    expect(calls).toHaveLength(2)
  })
})

describe('healthText', () => {
  it('describes each kind of check', () => {
    expect(healthText({ status: 'checking' })).toBe('Checking…')
    expect(healthText({ status: 'ok', latencyMs: 23 })).toBe('OK · 23 ms')
    expect(healthText({ status: 'error', failure: { kind: 'timeout' } })).toBe('No answer within 5 s')
    expect(healthText({ status: 'error', failure: { kind: 'status', code: 503 } })).toBe('Server answered 503')
    expect(healthText({ status: 'error', failure: { kind: 'unreachable' } })).toBe('Could not reach the server')
  })
})

describe('secondsUntil', () => {
  it('rounds up, so a part of a second left still counts as one', () => {
    expect(secondsUntil(5_000, 0)).toBe(5)
    expect(secondsUntil(5_000, 4_999)).toBe(1)
  })

  it('is 0 once the moment has come or passed, never negative', () => {
    expect(secondsUntil(5_000, 5_000)).toBe(0)
    expect(secondsUntil(5_000, 7_000)).toBe(0)
  })
})

describe('nextCheckText', () => {
  it('says how many seconds are left, or "now"', () => {
    expect(nextCheckText(4)).toBe('in 4 s')
    expect(nextCheckText(0)).toBe('now')
  })
})
