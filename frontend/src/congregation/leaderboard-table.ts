import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { BoardEntry, BoardRound } from '../types'

/** What the "This round" column says for one row. Text, never just a
 * color or an icon, so it reads the same to everyone. */
function thisRound(entry: BoardEntry, round: BoardRound): string {
  if (entry.status.Case === 'Left') return 'Left'
  switch (round.Case) {
    case 'NotStarted':
      return '—'
    case 'Guessing':
      return entry.guessedThisRound ? 'Guessed' : 'Waiting'
    case 'Revealed':
      return entry.pointsThisRound === undefined || entry.pointsThisRound === null
        ? 'No guess'
        : `+${entry.pointsThisRound}`
  }
}

/**
 * The Congregation leaderboard as a native table — shared by the
 * players' game view, their results and the spectator board (see
 * docs/web/congregation). A real <table> with a caption and column
 * headers, so a screen reader can move through it by row and column.
 */
@customElement('bg-leaderboard-table')
export class LeaderboardTable extends LitElement {
  @property({ attribute: false })
  entries: BoardEntry[] = []

  @property({ attribute: false })
  round: BoardRound = { Case: 'NotStarted' }

  @property()
  caption = 'Leaderboard'

  /** Marks this player's own row with "(you)". */
  @property({ attribute: false })
  myPlayerId?: string

  /** Larger type for a projector or TV — see spectator-board.ts. */
  @property({ type: Boolean, reflect: true })
  large = false

  render() {
    return html`
      <table>
        <caption>${this.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <th scope="col" class="number">Score</th>
            <th scope="col">This round</th>
          </tr>
        </thead>
        <tbody>
          ${this.entries.map(
            (entry) => html`
              <tr class=${entry.playerId === this.myPlayerId ? 'me' : ''}>
                <td>${entry.rank}</td>
                <th scope="row">
                  ${entry.name}${entry.playerId === this.myPlayerId ? ' (you)' : ''}
                  ${entry.status.Case === 'Disconnected' ? html`<span class="status">(offline)</span>` : null}
                </th>
                <td class="number">${entry.score}</td>
                <td>${thisRound(entry, this.round)}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    `
  }

  static styles = css`
    :host {
      display: block;
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }

    :host([large]) table {
      font-size: clamp(1rem, 2.4vw, 2rem);
    }

    caption {
      text-align: left;
      font-weight: 700;
      padding-bottom: 0.4rem;
    }

    th,
    td {
      text-align: left;
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--border);
    }

    tbody th {
      font-weight: 600;
    }

    .number {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* Your own row stands out by its "(you)" text first; the outline is
       an extra cue, not the only one. */
    tr.me {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .status {
      color: var(--text-muted);
      font-weight: 400;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-leaderboard-table': LeaderboardTable
  }
}
