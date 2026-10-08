import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { buttonStyles } from '../shared-ui/button-styles'
import type { LeaderboardSnapshot } from '../types'
import type { CongregationResult } from './congregation-state'
import './leaderboard-table'

/** "1st", "2nd", "3rd", "4th", "11th", "22nd"… */
export function ordinal(n: number): string {
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function placing(board: LeaderboardSnapshot | undefined, myPlayerId: string): string | undefined {
  const mine = board?.entries.find((e) => e.playerId === myPlayerId)
  if (!board || !mine) return undefined
  const shared = board.entries.filter((e) => e.rank === mine.rank).length > 1
  return `You finished ${shared ? 'joint ' : ''}${ordinal(mine.rank)} of ${board.entries.length}, with ${mine.score} points.`
}

/**
 * The final standings of a Congregation, shown to its participants once
 * the game is over — see docs/web/congregation. Fires `back-to-room` when
 * the player is done looking.
 */
@customElement('bg-congregation-results')
export class CongregationResults extends LitElement {
  @property({ attribute: false })
  result!: CongregationResult

  @property({ attribute: false })
  myPlayerId = ''

  render() {
    const board = this.result.board

    return html`
      <section aria-labelledby="results-title">
        <h2 id="results-title">Final standings</h2>
        ${this.result.reason.Case === 'Abandoned'
          ? html`<p>Everyone left, so the game ended early.</p>`
          : null}
        <p class="placing">${placing(board, this.myPlayerId) ?? ''}</p>
        <bg-leaderboard-table
          .entries=${board?.entries ?? []}
          .round=${board?.round ?? { Case: 'NotStarted' }}
          .myPlayerId=${this.myPlayerId}
          caption="Final leaderboard"
        ></bg-leaderboard-table>
        <button type="button" @click=${this.onBack}>Back to the room</button>
      </section>
    `
  }

  private onBack() {
    this.dispatchEvent(new CustomEvent('back-to-room', { bubbles: true, composed: true }))
  }

  static styles = [
    buttonStyles,
    css`
      section {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
      }

      bg-leaderboard-table {
        align-self: stretch;
      }

      h2,
      p {
        margin: 0;
      }

      .placing {
        font-weight: 600;
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-congregation-results': CongregationResults
  }
}
