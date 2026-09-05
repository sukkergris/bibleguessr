import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { getGameHubConnection, onConnectionStateChange, type ConnectionState } from '../signalr-client'

type HttpCheck = { status: 'checking' } | { status: 'ok'; latencyMs: number } | { status: 'error'; message: string }

/** One line in the details panel.
 *
 * `ok` drives both the row's colour and the dot's, so a red row always
 * turns the dot red. `summary` is what the dot says when this row is the
 * reason — absent when the row has nothing to report. */
interface ConnectionRow {
  id: 'device' | 'http' | 'realtime'
  label: string
  /** Secondary text under the label, e.g. the host or transport. */
  detail: string | undefined
  ok: boolean
  value: string
  summary: string | undefined
}

/** How often to re-check HTTP health while everything looks fine. Long,
 * because a healthy server does not need poking. */
const RECHECK_INTERVAL_MS = 15_000

/** How often to re-check once something looks wrong.
 *
 * A player who has just lost their connection is watching the indicator
 * and wants to know when it comes back; waiting out the healthy interval
 * made the indicator feel untrustworthy — see
 * docs/SCRUM/DONE/Bug.CantTrustConnectionStatusIconRightUpperCorner.md.
 * This only applies while unhealthy, so a working server is still polled
 * at the slow rate. */
const UNHEALTHY_RECHECK_INTERVAL_MS = 3_000

/**
 * A small, always-visible diagnostic strip: is the backend reachable over
 * plain HTTP, and (only once `trackSignalR` is set — see below) is the
 * SignalR hub connection up. Exists because "it doesn't work" has
 * repeatedly turned out to be the backend process not running, or a
 * devcontainer port-forwarding gap between the browser and the server —
 * both invisible without opening DevTools. This surfaces that state right
 * in the app, at a glance, without needing to reach for the Network/Console
 * tabs every time. Collapsed to a small dot by default; expands to the
 * detail on click.
 */
@customElement('bg-connection-status')
export class ConnectionStatus extends LitElement {
  // The SignalR hub connection is only opened once this is true — set by
  // bg-app.ts when the player has actually chosen Multiplayer, so a
  // singleplayer session never pays for a hub connection it won't use.
  // Flipping it true later (after starting false) begins tracking from
  // that point on; it never goes back to not-tracking once started.
  @property({ type: Boolean })
  trackSignalR = false

  @state()
  private http: HttpCheck = { status: 'checking' }

  @state()
  private signalR: ConnectionState | 'connecting' | 'not-started' = 'not-started'

  @state()
  private expanded = false

  private _unsubscribeConnectionState?: () => void
  private _recheckTimer?: ReturnType<typeof setInterval>
  private _recheckIntervalMs?: number
  // Aborted on disconnect so an in-flight health check from a
  // torn-down instance (e.g. a Vite HMR reload swapping this component)
  // doesn't resolve/reject into a component that's no longer live — it
  // otherwise showed up as a spurious "(canceled)" request with nothing
  // wrong on the server side, purely a dev-mode artifact of teardown timing.
  private _httpCheckAbort?: AbortController

  /** What the browser says about its own network. Shown as its own row:
   * a player whose network dropped otherwise sees "Server unreachable"
   * and blames the server for a local problem — see
   * docs/SCRUM/TODO/Feature.ConnectionPanelRefinements.md. Still only a
   * hint about the backend: a machine can be online while this server is
   * not reachable. */
  @state()
  private browserOnline = navigator.onLine

  /** Seconds until the next automatic check, so a reader can tell how old
   * the latency figure is rather than guessing. */
  @state()
  private secondsToNextCheck = 0

  private _countdownTimer?: ReturnType<typeof setInterval>
  private _nextCheckAt?: number

  connectedCallback() {
    super.connectedCallback()
    void this._checkHttp()
    this._scheduleRecheck()
    // The browser knows about its own connectivity long before a WebSocket
    // notices — the socket can stay apparently open until keep-alive
    // expires, which measured at ~15s. Treated strictly as a hint that
    // something changed, prompting an immediate re-check rather than being
    // reported as truth: navigator.onLine says nothing about whether THIS
    // backend is reachable (see the bug report's note on it).
    window.addEventListener('offline', this._onConnectivityHint)
    window.addEventListener('online', this._onConnectivityHint)
    if (this.trackSignalR) this._startTrackingSignalR()
  }

  // willUpdate (not updated!) runs before render, as part of the SAME
  // update cycle — so setting `this.signalR` here folds into the update
  // already in progress. Doing this in `updated()` instead mutates state
  // AFTER the update completes, which schedules a whole new update as a
  // side effect of the one that just finished (Lit warns about exactly
  // this: https://lit.dev/msg/change-in-update).
  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('trackSignalR') && this.trackSignalR && this.signalR === 'not-started') {
      this._startTrackingSignalR()
    }
  }

  private _startTrackingSignalR() {
    this.signalR = 'connecting'
    this._unsubscribeConnectionState = onConnectionStateChange((state) => {
      this.signalR = state
    })
    getGameHubConnection().catch(() => {
      // onConnectionStateChange only fires once the connection resolves;
      // if .start() itself rejects (e.g. negotiate times out), reflect
      // that as disconnected too instead of staying stuck on "connecting".
      this.signalR = 'disconnected'
    })
  }

  private _onConnectivityHint = () => {
    this.browserOnline = navigator.onLine
    void this._checkHttp()
  }

  disconnectedCallback() {
    window.removeEventListener('offline', this._onConnectivityHint)
    window.removeEventListener('online', this._onConnectivityHint)
    this._unsubscribeConnectionState?.()
    clearInterval(this._recheckTimer)
    clearInterval(this._countdownTimer)
    this._httpCheckAbort?.abort()
    super.disconnectedCallback()
  }

  /** (Re)starts the health-check timer at the rate the current state
   * warrants. Called after every check, so the rate follows the state
   * rather than being fixed at construction. */
  private _scheduleRecheck() {
    const interval = this._isHealthy ? RECHECK_INTERVAL_MS : UNHEALTHY_RECHECK_INTERVAL_MS
    if (this._recheckIntervalMs === interval && this._recheckTimer !== undefined) return

    if (this._recheckTimer !== undefined) clearInterval(this._recheckTimer)
    this._recheckIntervalMs = interval
    this._recheckTimer = setInterval(() => void this._checkHttp(), interval)
    this._restartCountdown(interval)
  }

  /** Drives the visible countdown. Separate from the poll timer so the
   * display ticks every second regardless of how far apart the actual
   * checks are. */
  private _restartCountdown(intervalMs: number) {
    this._nextCheckAt = Date.now() + intervalMs
    this._tickCountdown()

    if (this._countdownTimer !== undefined) return
    this._countdownTimer = setInterval(() => this._tickCountdown(), 1_000)
  }

  private _tickCountdown() {
    if (this._nextCheckAt === undefined) return
    this.secondsToNextCheck = Math.max(0, Math.ceil((this._nextCheckAt - Date.now()) / 1000))
  }

  private async _checkHttp() {
    // Cancel any still-in-flight check from a previous call before starting
    // a new one — RECHECK_INTERVAL_MS could otherwise overlap a slow
    // request with a fresh one.
    this._httpCheckAbort?.abort()
    const controller = new AbortController()
    this._httpCheckAbort = controller
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 5000)

    // Reset here rather than only in the scheduler: a check can also be
    // triggered by a connectivity change, and the countdown would
    // otherwise keep running down to a check that already happened.
    this._nextCheckAt = Date.now() + (this._recheckIntervalMs ?? RECHECK_INTERVAL_MS)
    this._tickCountdown()

    const start = performance.now()
    try {
      const response = await fetch(`${api.baseUrl}/api/healthz`, { signal: controller.signal })
      const latencyMs = Math.round(performance.now() - start)
      this.http = response.ok
        ? { status: 'ok', latencyMs }
        : { status: 'error', message: `Server responded ${response.status} ${response.statusText}` }
    } catch (err) {
      // A deliberate abort from disconnectedCallback/a superseding check
      // (not a timeout, not a real network failure) — the component may
      // already be gone, and even if not, a fresher check's result (or
      // none, if it's mid-flight) is what should be shown, not an error
      // for a request we cancelled ourselves.
      if (err instanceof DOMException && err.name === 'AbortError') return

      const message =
        err instanceof DOMException && err.name === 'TimeoutError'
          ? 'Timed out reaching the server'
          : err instanceof Error
            ? err.message
            : 'Could not reach the server'
      this.http = { status: 'error', message }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // "not-started" (SignalR not yet needed — singleplayer/pre-multiplayer)
  // doesn't count as unhealthy; only an actual connection problem does.
  /** Re-evaluates the poll rate after every state change, so losing the
   * connection speeds polling up and regaining it slows it back down. */
  protected updated() {
    this._scheduleRecheck()
  }

  /**
   * Each row the panel shows, as an explicit object rather than a handful
   * of getters that had to agree with each other by hand — see CLAUDE.md's
   * preference for explicit state models.
   *
   * `ok` is the single source of truth for colour. Two colours only: red
   * means something is wrong, green means nothing is. A row that measures
   * nothing (no hub connection outside multiplayer) is green, because
   * nothing is wrong — the text says it is not in use.
   */
  private get _rows(): ConnectionRow[] {
    return [this._deviceRow, this._httpRow, this._realtimeRow]
  }

  /** What the browser reports about its own network. */
  private get _deviceRow(): ConnectionRow {
    return {
      id: 'device',
      label: 'This device',
      detail: undefined,
      ok: this.browserOnline,
      value: this.browserOnline ? 'online' : 'offline',
      summary: this.browserOnline ? undefined : 'No network on this device',
    }
  }

  private get _httpRow(): ConnectionRow {
    if (this.http.status === 'checking') {
      return { id: 'http', label: '/api/healthz', detail: api.baseUrl, ok: true, value: 'checking…', summary: 'Checking…' }
    }
    if (this.http.status === 'ok') {
      return {
        id: 'http',
        label: '/api/healthz',
        detail: api.baseUrl,
        ok: true,
        value: `OK · ${this.http.latencyMs}ms`,
        summary: undefined,
      }
    }
    return {
      id: 'http',
      label: '/api/healthz',
      detail: api.baseUrl,
      ok: false,
      value: this.http.message,
      summary: 'Server unreachable',
    }
  }

  private get _realtimeRow(): ConnectionRow {
    const base = { id: 'realtime' as const, label: 'Realtime', detail: 'SignalR' }

    switch (this.signalR) {
      case 'not-started':
        // Nothing is wrong here: there is no hub connection to break
        // outside multiplayer. The text carries that, not a third colour.
        return { ...base, ok: true, value: 'not used on this screen', summary: undefined }
      case 'connecting':
        return { ...base, ok: true, value: 'connecting…', summary: 'Connecting…' }
      case 'connected':
        return { ...base, ok: true, value: 'connected', summary: undefined }
      case 'reconnecting':
        return { ...base, ok: false, value: 'reconnecting…', summary: 'Reconnecting…' }
      default:
        return { ...base, ok: false, value: 'disconnected', summary: 'Disconnected' }
    }
  }

  /** The dot is red when ANY row is red. Derived from the same objects the
   * panel renders, so the two can never disagree — previously the dot
   * ignored the browser's own connectivity entirely, and stayed green
   * while the panel said the device was offline. */
  private get _isHealthy(): boolean {
    return this._rows.every((row) => row.ok)
  }

  /** What the dot says in words. The first failing row wins, so the most
   * specific problem is named rather than a generic "something is wrong";
   * falling back to the first row that has anything to say at all. */
  private get _statusText(): string {
    const failing = this._rows.find((row) => !row.ok && row.summary)
    if (failing?.summary) return failing.summary

    const pending = this._rows.find((row) => row.summary)
    return pending?.summary ?? 'Connected'
  }

  render() {
    return html`
      <button
        type="button"
        class="dot ${this._isHealthy ? 'ok' : 'bad'}"
        @click=${() => (this.expanded = !this.expanded)}
        title=${`Connection status: ${this._statusText} — click for details`}
        aria-label=${`Connection status: ${this._statusText}. Show details.`}
        aria-expanded=${this.expanded ? 'true' : 'false'}
      ></button>
      ${this.expanded ? this._renderDetails() : null}
    `
  }

  private _renderDetails() {
    return html`
      <div class="details" role="group" aria-labelledby="connection-status-heading">
        <!-- Names the panel for screen readers as well as sighted users:
             it previously opened straight into two data rows, so there
             was nothing saying what they described. -->
        <h2 id="connection-status-heading">Connection status</h2>

        <dl>
          ${this._rows.map((row) => this._renderRow(row))}
        </dl>

        ${!this.browserOnline
          ? html`
              <p class="hint">
                Your device reports no network connection, so the server has not been reached. This is local — the
                server may be perfectly healthy.
              </p>
            `
          : !this._isHealthy
            ? html`
                <p class="hint">
                  If the backend is reachable elsewhere (e.g. from a terminal <code>curl</code>) but not here, this is
                  usually a port-forwarding gap between the browser and the server — check the PORTS tab.
                </p>
              `
            : null}
      </div>
    `
  }

  /** One row, rendered straight from its state object — the row decides
   * its own colour via `ok`, so the panel cannot drift out of step with
   * the dot above it. */
  private _renderRow(row: ConnectionRow) {
    return html`
      <div class="row ${row.ok ? '' : 'row-bad'}">
        <dt>
          ${row.id === 'http' ? html`<code>${row.label}</code>` : row.label}
          ${row.detail ? html`<span class="host">${row.detail}</span>` : null}
        </dt>
        <dd class="value ${row.ok ? 'ok' : 'bad'}">
          <!-- The countdown belongs to the check it counts down to, so it
               sits in that row rather than floating under the panel, and
               ahead of the value so the result stays the rightmost thing
               the eye lands on. aria-hidden: useful to look at, useless to
               hear once a second — the row's value carries the state. -->
          ${row.id === 'http'
            ? html`<span class="next-check" aria-hidden="true">${this.secondsToNextCheck}s</span>`
            : null}
          ${row.value}
        </dd>
      </div>
    `
  }

  static styles = css`
    :host {
      position: fixed;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 1000;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    .dot {
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 999px;
      border: none;
      padding: 0;
      cursor: pointer;
    }

    .dot.ok {
      background: var(--success);
    }

    .dot.bad {
      background: #dc2626;
      animation: pulse 1.4s ease-in-out infinite;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }

    .details {
      position: absolute;
      top: 1.5rem;
      right: 0;
      width: 19rem;
      padding: 0.75rem;
      border-radius: 8px;
      background: var(--surface-raised);
      /* Was a hard-coded #ddd, which stayed light in dark mode — the same
         class of miss as the white backgrounds fixed earlier. */
      border: 1px solid var(--border);
      box-shadow: 0 4px 16px var(--overlay);
      font-size: 0.8rem;
    }

    dl {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    /* Hairline separators rather than boxes: enough structure for the eye
       to find a row without the panel turning into a table. */
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.75rem;
      padding: 0.35rem 0.1rem;
      border-top: 1px solid var(--border);
    }

    .row:first-child {
      border-top: none;
    }

    /* A failing row is marked by weight and a left rule as well as
       colour, so the state is not carried by hue alone. */
    .row-bad {
      border-left: 3px solid var(--error);
      padding-left: 0.4rem;
      margin-left: -0.4rem;
    }

    dt {
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }

    dd {
      margin: 0;
    }

    /* The endpoint's host sits under its name rather than beside it: the
       URL is long, and pushing it onto its own line keeps the value
       column aligned instead of wrapping mid-row. */
    .host {
      font-size: 0.9em;
      opacity: 0.75;
      word-break: break-all;
    }

    dt code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text);
    }

    /* Sits beside the value it belongs to, muted so it reads as metadata
       about the row rather than as part of the result. */
    .next-check {
      margin-right: 0.4rem;
      font-size: 0.75rem;
      font-weight: 400;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }


    h2 {
      margin: 0 0 0.4rem;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .value {
      font-weight: 600;
      text-align: right;
      word-break: break-word;
    }

    .value.ok {
      color: var(--success);
    }

    .value.bad {
      color: var(--error);
    }

    .hint {
      margin: 0.5rem 0 0;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      line-height: 1.4;
    }


    .hint code {
      background: rgba(170, 59, 255, 0.12);
      padding: 0.1rem 0.3rem;
      border-radius: 4px;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-connection-status': ConnectionStatus
  }
}
