import { LitElement, css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { api } from '../api'
import { requestNerdPanelOpen } from '../nerd-panel-control'
import { healthText, serverHealth, type ServerHealthSnapshot } from '../server-health'
import { getGameHubConnection, onConnectionStateChange, type ConnectionState } from '../signalr-client'
import { buttonStyles } from '../shared-ui/button-styles'

/** One line in the details panel.
 *
 * `ok` drives both the row's color and the dot's, so a red row always
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
 *
 * The details end with a Nerd panel button: the panel's only way in that
 * doesn't need a keyboard — see docs/web/connection-status.
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

  /** The app's shared /api/healthz check — see server-health.ts. The
   * nerd panel shows the same one. */
  @state()
  private health: ServerHealthSnapshot = { check: { status: 'checking' }, secondsToNextCheck: 0 }

  @state()
  private signalR: ConnectionState | 'connecting' | 'not-started' = 'not-started'

  @state()
  private expanded = false

  @query('.dot')
  private _dot!: HTMLButtonElement

  private _unsubscribeConnectionState?: () => void
  private _unsubscribeHealth?: () => void

  /** What the browser says about its own network. Shown as its own row:
   * a player whose network dropped otherwise sees "Server unreachable"
   * and blames the server for a local problem — see
   * docs/SCRUM/TODO/Feature.ConnectionPanelRefinements.md. Still only a
   * hint about the backend: a machine can be online while this server is
   * not reachable. */
  @state()
  private browserOnline = navigator.onLine

  connectedCallback() {
    super.connectedCallback()
    this._unsubscribeHealth = serverHealth.subscribe((health) => (this.health = health))
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
    // Something the health check can't see is wrong (no network on this
    // device, a dropped hub connection): check more often, so recovery is
    // noticed quickly. Here rather than in updated() for the same reason
    // as above — the snapshot it may push folds into this update.
    serverHealth.setUrgent(!this._rows.filter((row) => row.id !== 'http').every((row) => row.ok))
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
    serverHealth.checkNow()
  }

  disconnectedCallback() {
    window.removeEventListener('offline', this._onConnectivityHint)
    window.removeEventListener('online', this._onConnectivityHint)
    this._unsubscribeConnectionState?.()
    this._unsubscribeHealth?.()
    super.disconnectedCallback()
  }

  /**
   * Each row the panel shows, as an explicit object rather than a handful
   * of getters that had to agree with each other by hand — see CLAUDE.md's
   * preference for explicit state models.
   *
   * `ok` is the single source of truth for color. Two colors only: red
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

  /** The shared health check, in the same words the nerd panel uses. */
  private get _httpRow(): ConnectionRow {
    const base = { id: 'http' as const, label: '/api/healthz', detail: api.baseUrl, value: healthText(this.health.check) }

    switch (this.health.check.status) {
      case 'checking':
        return { ...base, ok: true, summary: 'Checking…' }
      case 'ok':
        return { ...base, ok: true, summary: undefined }
      case 'error':
        return { ...base, ok: false, summary: 'Server unreachable' }
    }
  }

  private get _realtimeRow(): ConnectionRow {
    const base = { id: 'realtime' as const, label: 'Realtime', detail: 'SignalR' }

    switch (this.signalR) {
      case 'not-started':
        // Nothing is wrong here: there is no hub connection to break
        // outside multiplayer. The text carries that, not a third color.
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

  /** Closes these details — they would cover the top of the panel — and
   * opens the nerd panel, with focus going back to the dot when it closes. */
  private _openNerdPanel = () => {
    this.expanded = false
    requestNerdPanelOpen({ returnFocusTo: this._dot })
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

        <button type="button" class="secondary compact nerd-panel" @click=${this._openNerdPanel}>Nerd panel</button>
      </div>
    `
  }

  /** One row, rendered straight from its state object — the row decides
   * its own color via `ok`, so the panel cannot drift out of step with
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
            ? html`<span class="next-check" aria-hidden="true">${this.health.secondsToNextCheck}s</span>`
            : null}
          ${row.value}
        </dd>
      </div>
    `
  }

  static styles = [
    buttonStyles,
    css`
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
       color, so the state is not carried by hue alone. */
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

    .nerd-panel {
      display: block;
      width: 100%;
      margin-top: 0.75rem;
    }
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-connection-status': ConnectionStatus
  }
}
