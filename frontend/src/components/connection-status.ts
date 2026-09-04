import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { getGameHubConnection, onConnectionStateChange, type ConnectionState } from '../signalr-client'

type HttpCheck = { status: 'checking' } | { status: 'ok'; latencyMs: number } | { status: 'error'; message: string }

const RECHECK_INTERVAL_MS = 15_000

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

  connectedCallback() {
    super.connectedCallback()
    void this._checkHttp()
    this._recheckTimer = setInterval(() => void this._checkHttp(), RECHECK_INTERVAL_MS)
    if (this.trackSignalR) this._startTrackingSignalR()
  }

  updated(changedProperties: Map<string, unknown>) {
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

  disconnectedCallback() {
    this._unsubscribeConnectionState?.()
    clearInterval(this._recheckTimer)
    super.disconnectedCallback()
  }

  private async _checkHttp() {
    const start = performance.now()
    try {
      const response = await fetch(`${api.baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) })
      const latencyMs = Math.round(performance.now() - start)
      this.http = response.ok
        ? { status: 'ok', latencyMs }
        : { status: 'error', message: `Server responded ${response.status} ${response.statusText}` }
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'TimeoutError'
          ? 'Timed out reaching the server'
          : err instanceof Error
            ? err.message
            : 'Could not reach the server'
      this.http = { status: 'error', message }
    }
  }

  // "not-started" (SignalR not yet needed — singleplayer/pre-multiplayer)
  // doesn't count as unhealthy; only an actual connection problem does.
  private get _isHealthy(): boolean {
    return this.http.status === 'ok' && (this.signalR === 'connected' || this.signalR === 'not-started')
  }

  render() {
    return html`
      <button
        type="button"
        class="dot ${this._isHealthy ? 'ok' : 'bad'}"
        @click=${() => (this.expanded = !this.expanded)}
        title="Connection status — click for details"
      ></button>
      ${this.expanded ? this._renderDetails() : null}
    `
  }

  private _renderDetails() {
    return html`
      <div class="details">
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
          <span class="value ${this.signalR === 'connected' || this.signalR === 'not-started' ? 'ok' : 'bad'}">
            ${this.signalR === 'not-started'
              ? 'not needed yet'
              : this.signalR === 'connecting'
                ? 'connecting…'
                : this.signalR === 'connected'
                  ? 'connected'
                  : 'disconnected'}
          </span>
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
      background: #16a34a;
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
      background: white;
      border: 1px solid #ddd;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      font-size: 0.8rem;
    }

    @media (prefers-color-scheme: dark) {
      .details {
        background: #1f1b24;
        border-color: #3a3440;
      }
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.75rem;
      padding: 0.25rem 0;
    }

    .label {
      color: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      .label {
        color: #9ca3af;
      }
    }

    .value {
      font-weight: 600;
      text-align: right;
      word-break: break-word;
    }

    .value.ok {
      color: #16a34a;
    }

    .value.bad {
      color: #dc2626;
    }

    .value.checking {
      color: #6b6375;
    }

    .hint {
      margin: 0.5rem 0 0;
      padding-top: 0.5rem;
      border-top: 1px solid #eee;
      color: #6b6375;
      line-height: 1.4;
    }

    @media (prefers-color-scheme: dark) {
      .hint {
        border-top-color: #3a3440;
        color: #9ca3af;
      }
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
