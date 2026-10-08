import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { nameOfWire } from '../game-types/registry'
import { onLeaderboardUpdated, onReconnected, unwatchRoom, watchRoom } from '../signalr-client'
import { computeRemainingSeconds } from '../timer'
import type { LeaderboardSnapshot } from '../types'
import { announcementFor } from './board-announcer'
import './leaderboard-table'

/** How often the countdown redraws — cosmetic only. */
const COUNTDOWN_TICK_MS = 250

/**
 * The live Congregation leaderboard for a projector or TV — opened by
 * anyone with the `/watch/<code>` link, no name and no join (see
 * docs/web/congregation and routing/routes.ts).
 *
 * Shows only what the server's LeaderboardSnapshot carries: names,
 * scores, who has guessed, and — once a round is scored — its reference.
 * It never imports a Bible source and has no way to show verse text
 * (architecture.test.ts holds it to that).
 */
@customElement('bg-spectator-board')
export class SpectatorBoard extends LitElement {
  @property()
  roomCode = ''

  @state()
  private board?: LeaderboardSnapshot

  @state()
  private error?: string

  @state()
  private announcement = ''

  @state()
  private now = Date.now()

  private unsubscribers: Array<() => void> = []
  private tickHandle?: ReturnType<typeof setInterval>

  connectedCallback() {
    super.connectedCallback()
    this.unsubscribers = [
      onLeaderboardUpdated((board) => {
        if (board.roomCode === this.roomCode) this.show(board)
      }),
      // SignalR forgets group membership on reconnect — watch again.
      onReconnected(() => void this.watch()),
    ]
    this.tickHandle = setInterval(() => (this.now = Date.now()), COUNTDOWN_TICK_MS)
    void this.watch()
  }

  disconnectedCallback() {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    if (this.tickHandle !== undefined) clearInterval(this.tickHandle)
    unwatchRoom(this.roomCode).catch(() => {
      // Best effort: the server drops the connection's groups when it
      // closes anyway.
    })
    super.disconnectedCallback()
  }

  private async watch() {
    try {
      this.show(await watchRoom(this.roomCode))
      this.error = undefined
    } catch (err) {
      console.error('[bg-spectator-board] failed to watch room', err)
      this.error = `There is no room ${this.roomCode}. Check the link, or ask the host for a new one.`
    }
  }

  private show(board: LeaderboardSnapshot) {
    const said = announcementFor(this.board, board)
    if (said) this.announcement = said
    this.board = board
  }

  render() {
    return html`
      <main>
        <h1>Room <span class="code">${this.roomCode}</span></h1>
        <!-- The one live region: only the moments worth hearing (see
             board-announcer.ts), never every guess or clock tick. -->
        <p class="visually-hidden" role="status">${this.announcement}</p>
        ${this.error ? html`<p class="error">${this.error}</p>` : this.renderBoard()}
      </main>
    `
  }

  private renderBoard() {
    const board = this.board
    if (!board) return html`<p class="muted">Connecting…</p>`

    switch (board.phase.Case) {
      case 'NoCongregation':
        return html`
          <p class="big">No Congregation yet.</p>
          <p class="muted">This board fills in by itself when someone in room ${this.roomCode} hosts one.</p>
        `
      case 'LobbyOpen':
        return html`
          <p class="big">${board.hostName} is gathering a Congregation.</p>
          <p class="muted">
            ${this.gameSummary(board)} · Join from BibleGuessr with room code
            <strong>${this.roomCode}</strong>.
          </p>
          <h2>Joined so far (${board.entries.length})</h2>
          <ul class="members">
            ${board.entries.map((e) => html`<li>${e.name}</li>`)}
          </ul>
        `
      case 'Playing':
      case 'Finished':
        return html`
          ${this.renderRoundLine(board)}
          <bg-leaderboard-table
            large
            .entries=${board.entries}
            .round=${board.round}
            caption=${board.phase.Case === 'Finished' ? 'Final leaderboard' : 'Leaderboard'}
          ></bg-leaderboard-table>
        `
    }
  }

  private gameSummary(board: LeaderboardSnapshot) {
    const kind = board.gameType ? nameOfWire(board.gameType) : 'Congregation'
    return `${kind} · ${board.roundCount} verses`
  }

  private renderRoundLine(board: LeaderboardSnapshot) {
    const round = board.round
    if (board.phase.Case === 'Finished') return html`<p class="big">The game is over.</p>`

    switch (round.Case) {
      case 'NotStarted':
        return null
      case 'Guessing': {
        const [number, deadline] = round.Fields
        const remaining = computeRemainingSeconds(deadline, this.now)
        return html`
          <p class="big">
            Verse ${number} of ${board.roundCount}
            <!-- Visual only: a ticking number in a live region would never stop talking. -->
            <span class="timer" aria-hidden="true">${remaining ?? ''}s</span>
          </p>
        `
      }
      case 'Revealed': {
        const [number, reference] = round.Fields
        return html`
          <p class="big">
            Verse ${number} of ${board.roundCount}: ${reference.book} ${reference.chapter}:${reference.verseNumber}
          </p>
        `
      }
    }
  }

  static styles = css`
    :host {
      display: block;
    }

    main {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      max-width: 72rem;
      margin: 0 auto;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.5rem, 4vw, 3rem);
    }

    h2 {
      margin: 0;
      font-size: clamp(1.1rem, 2.5vw, 2rem);
    }

    .code {
      font-family: monospace;
      color: var(--accent);
    }

    .big {
      margin: 0;
      font-size: clamp(1.25rem, 3vw, 2.5rem);
      font-weight: 700;
    }

    .muted {
      margin: 0;
      color: var(--text-muted);
      font-size: clamp(1rem, 2vw, 1.5rem);
    }

    .timer {
      margin-left: 1rem;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }

    .members {
      margin: 0;
      padding-left: 1.5rem;
      font-size: clamp(1rem, 2.2vw, 1.75rem);
      columns: 14rem;
    }

    .error {
      color: var(--error);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-spectator-board': SpectatorBoard
  }
}
