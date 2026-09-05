import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { VerseReference } from '../types'

/** One round's outcome for both players, accumulated client-side across a
 * multiplayer game — see multiplayer-game.ts, which builds this list by
 * appending on every RoundScored it receives (the server itself keeps no
 * round history — see backend/Domain/Game.fs's GameSession doc comment).
 * Only a VerseReference (never the full Verse/text) — this results screen
 * only ever needs to display "Book Chapter:Verse", and different players
 * may have resolved this round's verse from different translations
 * anyway, so there's no single "the" text to show here. */
export interface MultiplayerRoundSummary {
  verse: VerseReference
  myPoints: number
  opponentPoints: number
}

export interface MultiplayerGameOverDetail {
  myPlayerName: string
  opponentName: string
  myScore: number
  opponentScore: number
  /** Why the game ended — see types.ts's GameOverReason. Undefined
   * `winner` on a Forfeited reason means both players went stale at once
   * (an edge case with no meaningful winner to declare). */
  reason: { kind: 'completed' } | { kind: 'forfeited'; winnerIsMe?: boolean }
  rounds: MultiplayerRoundSummary[]
}

/**
 * The end-of-game summary for a multiplayer match — final scores, a
 * per-round breakdown, and a way back to the room. Not a reuse of
 * singleplayer's <bg-game-results>, which is hard-wired to one player's
 * RoundResult[] and a share-text format tied to singleplayer's
 * book/chapter/verse point tiers — a two-player win/lose/tie result needs
 * different framing entirely.
 *
 * Fires a `back-to-room` CustomEvent when the player dismisses the screen.
 */
@customElement('bg-multiplayer-results')
export class MultiplayerResults extends LitElement {
  @property({ attribute: false })
  result!: MultiplayerGameOverDetail

  render() {
    const { myPlayerName, opponentName, myScore, opponentScore, reason, rounds } = this.result

    return html`
      <div class="results">
        <h1>${this._headline(myScore, opponentScore, reason)}</h1>

        <div class="tally">
          <div class="score-row me">
            <span>${myPlayerName}</span>
            <strong>${myScore}</strong>
          </div>
          <div class="score-row opponent">
            <span>${opponentName}</span>
            <strong>${opponentScore}</strong>
          </div>
        </div>

        ${rounds.length > 0
          ? html`
              <ol class="rounds">
                ${rounds.map(
                  (r, i) => html`
                    <li>
                      <span class="round-num">#${i + 1}</span>
                      <span class="reference">${r.verse.book} ${r.verse.chapter}:${r.verse.verseNumber}</span>
                      <span class="points mine">${r.myPoints}</span>
                      <span class="points theirs">${r.opponentPoints}</span>
                    </li>
                  `,
                )}
              </ol>
            `
          : null}

        <button type="button" @click=${this._onBackToRoom}>Back to room</button>
      </div>
    `
  }

  private _headline(
    myScore: number,
    opponentScore: number,
    reason: MultiplayerGameOverDetail['reason'],
  ): string {
    if (reason.kind === 'forfeited') {
      if (reason.winnerIsMe === undefined) return 'Game ended'
      return reason.winnerIsMe ? 'You won (opponent forfeited)' : 'You lost (forfeited)'
    }
    if (myScore === opponentScore) return "It's a tie!"
    return myScore > opponentScore ? 'You won!' : 'You lost'
  }

  private _onBackToRoom() {
    this.dispatchEvent(new CustomEvent('back-to-room', { bubbles: true, composed: true }))
  }

  static styles = css`
    :host {
      display: block;
    }

    .results {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    h1 {
      font-size: 1.4rem;
      margin: 0;
      text-align: center;
    }

    .tally {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .score-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      background: rgba(170, 59, 255, 0.08);
      font-size: 1.05rem;
    }

    .rounds {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .rounds li {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.3rem 0.6rem;
      font-size: 0.85rem;
      border-radius: 6px;
      background: rgba(170, 59, 255, 0.04);
    }

    .round-num {
      opacity: 0.6;
      min-width: 1.5rem;
    }

    .reference {
      flex: 1;
    }

    .points {
      min-width: 2.5rem;
      text-align: right;
      font-weight: 600;
    }

    .points.theirs {
      opacity: 0.7;
    }

    button {
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 1rem;
      cursor: pointer;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-multiplayer-results': MultiplayerResults
  }
}
