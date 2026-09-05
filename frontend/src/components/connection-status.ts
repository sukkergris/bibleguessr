import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { getGameHubConnection, onConnectionStateChange, type ConnectionState } from '../signalr-client'

type HttpCheck = { status: 'checking' } | { status: 'ok'; latencyMs: number } | { status: 'error'; message: string }

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
    void this._checkHttp()
  }

  disconnectedCallback() {
    window.removeEventListener('offline', this._onConnectivityHint)
    window.removeEventListener('online', this._onConnectivityHint)
    this._unsubscribeConnectionState?.()
    clearInterval(this._recheckTimer)
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
  }

  private async _checkHttp() {
    // Cancel any still-in-flight check from a previous call before starting
    // a new one — RECHECK_INTERVAL_MS could otherwise overlap a slow
    // request with a fresh one.
    this._httpCheckAbort?.abort()
    const controller = new AbortController()
    this._httpCheckAbort = controller
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 5000)

    const start = performance.now()
    try {
      const response = await fetch(`${api.baseUrl}/api/health`, { signal: controller.signal })
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

  private get _isHealthy(): boolean {
    return this.http.status === 'ok' && (this.signalR === 'connected' || this.signalR === 'not-started')
  }

  /** What the indicator actually says, in words.
   *
   * Realtime state is checked BEFORE HTTP: a reachable HTTP endpoint says
   * nothing about whether messages are still arriving, so letting it win
   * would let a healthy server mask a broken connection — the exact
   * complaint in
   * docs/SCRUM/DONE/Bug.CantTrustConnectionStatusIconRightUpperCorner.md.
   *
   * Reconnecting and disconnected are kept apart because they mean
   * different things to a player: one is "hold on", the other is "this is
   * not working". */
  private get _statusText(): string {
    if (this.signalR === 'reconnecting') return 'Reconnecting…'
    if (this.signalR === 'disconnected') return 'Disconnected'
    if (this.signalR === 'connecting') return 'Connecting…'
    if (this.http.status === 'checking') return 'Checking…'
    if (this.http.status !== 'ok') return 'Server unreachable'
    return 'Connected'
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

  /** Whether a realtime connection is even expected here. Outside the
   * multiplayer room there is no hub, so the row describes nothing —
   * which is different from describing something healthy. */
  private get _realtimeApplies(): boolean {
    return this.signalR !== 'not-started'
  }

  private get _realtimeTone(): string {
    if (!this._realtimeApplies) return 'inactive'
    if (this.signalR === 'connected') return 'ok'
    if (this.signalR === 'connecting') return 'checking'
    return 'bad'
  }

  private get _realtimeText(): string {
    if (!this._realtimeApplies) return 'not used on this screen'
    if (this.signalR === 'connecting') return 'connecting…'
    if (this.signalR === 'connected') return 'connected'
    if (this.signalR === 'reconnecting') return 'reconnecting…'
    return 'disconnected'
  }

  private _renderDetails() {
    return html`
      <div class="details" role="group" aria-labelledby="connection-status-heading">
        <!-- Names the panel for screen readers as well as sighted users:
             it previously opened straight into two data rows, so there
             was nothing saying what they described. -->
        <h2 id="connection-status-heading">Connection status</h2>
        <div class="row">
          <span class="label">Backend (${api.baseUrl})</span>
          ${this.http.status === 'checking'
            ? html`<span class="value checking">checking…</span>`
            : this.http.status === 'ok'
              ? html`<span class="value ok">OK · ${this.http.latencyMs}ms</span>`
              : html`<span class="value bad">${this.http.message}</span>`}
        </div>
        <div class="row">
          <span class="label">Realtime (SignalR)</span>
          <!-- Grey, not green, when there is no hub connection to report
               on. Showing it as a passing check invited the reading that
               something had been verified, when in fact the row simply
               does not apply outside multiplayer — see
               docs/SCRUM/BACKLOG/Flag.BrokenConnectionIndicator.md. -->
          <span class="value ${this._realtimeTone}">${this._realtimeText}</span>
        </div>
        ${!this._isHealthy
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
      width: 18rem;
      padding: 0.75rem;
      border-radius: 8px;
      background: var(--surface-raised);
      border: 1px solid #ddd;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      font-size: 0.8rem;
    }


    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.75rem;
      padding: 0.25rem 0;
    }

    .label {
      color: var(--text-muted);
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

    /* Deliberately the muted token, not a status colour: this row is
       reporting "no answer expected", which is neither good nor bad. */
    .value.inactive {
      color: var(--text-muted);
      font-weight: 400;
    }

    .value.checking {
      color: var(--text-muted);
    }

    .hint {
      margin: 0.5rem 0 0;
      padding-top: 0.5rem;
      border-top: 1px solid #eee;
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
