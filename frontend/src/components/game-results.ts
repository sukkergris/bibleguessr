import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { Guess, RoundResult } from '../types'
import { ALL_COLUMNS, composeShareText, type ResultColumn } from '../shared-kernel/result-sharing'
import { buttonStyles } from '../shared-ui/button-styles'
import { SHARE_OUTCOME_MESSAGES, gameUrl, shareOrCopy } from '../shared-ui/share-or-copy'

const MAX_POINTS_PER_ROUND = 1110 // book (10) + chapter (100) + verse (1000)

/**
 * End-of-game summary: total score, a per-round breakdown, and a "Share
 * result" button — the same kind of shared text as the daily quiz's (see
 * shared-kernel/result-sharing.ts): which parts of each verse were right,
 * when it was played and a link to the game.
 */
@customElement('bg-game-results')
export class GameResults extends LitElement {
  @property({ attribute: false })
  rounds: RoundResult[] = []

  /** The game type played, e.g. "Books" — for the shared result. */
  @property({ type: String })
  gameTypeName = ''

  /** Which parts of each verse the shared result shows — the game type
   * decides (see GameTypeDefinition.sharedColumns). */
  @property({ attribute: false })
  columns: readonly ResultColumn[] = ALL_COLUMNS

  /** When the game was finished (ISO 8601) — for the shared result. */
  @property({ type: String })
  finishedAt?: string

  /** What sharing last did, for the status line — undefined until shared. */
  @state()
  private shareStatus?: string

  private get totalScore() {
    return this.rounds.reduce((sum, r) => sum + r.points, 0)
  }

  private get maxScore() {
    return this.rounds.length * MAX_POINTS_PER_ROUND
  }

  render() {
    return html`
      <div class="results">
        <h1>Game over!</h1>
        <p class="total">${this.totalScore} <span class="max">/ ${this.maxScore}</span></p>

        <ol class="rounds">
          ${this.rounds.map(
            (r, i) => html`
              <li>
                <span class="round-num">#${i + 1}</span>
                <span class="reference">
                  ${r.points > 0
                    ? html`${r.verse.reference}`
                    : html`You guessed ${this._formatGuess(r.guess)} — it was ${r.verse.reference}`}
                </span>
                <span class="points">${r.points} pts</span>
              </li>
            `,
          )}
        </ol>

        <div class="actions">
          <button class="secondary" @click=${this._onShare}>Share result</button>
          <button @click=${this._onPlayAgain}>Play again</button>
        </div>
        <p class="share-status" role="status">${this.shareStatus ?? ''}</p>
      </div>
    `
  }

  // Renders a Guess the same way references are usually written, e.g.
  // "Matthæus", "Matthæus 1" or "Matthæus 1:1" — however far the player got.
  private _formatGuess(guess: Guess): string {
    if (guess.chapter === undefined) return guess.book
    if (guess.verseNumber === undefined) return `${guess.book} ${guess.chapter}`
    return `${guess.book} ${guess.chapter}:${guess.verseNumber}`
  }

  // Written like every share in the app — see
  // shared-kernel/result-sharing.ts.
  private _onShare = async () => {
    const text = composeShareText(
      [`BibleGuessr · ${this.gameTypeName}`, `${this.totalScore} points`],
      this.rounds.map((round) => ({ kind: 'answered', verse: round.verse, guess: round.guess, points: round.points })),
      this.finishedAt ?? new Date().toISOString(),
      gameUrl(),
      this.columns,
    )
    const outcome = await shareOrCopy(text)
    if (outcome !== 'cancelled') this.shareStatus = SHARE_OUTCOME_MESSAGES[outcome]
  }

  private _onPlayAgain() {
    this.dispatchEvent(new CustomEvent('play-again', { bubbles: true, composed: true }))
  }

  static styles = [
    buttonStyles,
    css`
    :host {
      display: block;
    }

    .results {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .total {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0;
    }

    .max {
      font-size: 1.25rem;
      font-weight: 400;
      color: var(--text-muted);
    }


    .rounds {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      text-align: left;
    }

    .rounds li {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      background: rgba(170, 59, 255, 0.08);
      font-size: 0.9rem;
    }

    .round-num {
      font-weight: 600;
      color: var(--text-muted);
      min-width: 1.75rem;
    }


    .reference {
      flex: 1;
    }

    .points {
      font-weight: 600;
    }

    .share-status {
      margin: 0;
      min-height: 1.2em;
      font-size: 0.9rem;
      color: var(--text-muted);
    }

    /* Side by side, sharing the row — narrower side padding keeps each
       label on one line at phone width. */
    .actions button {
      flex: 1;
      padding-inline: 0.75rem;
      white-space: nowrap;
    }

    .actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }



  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-results': GameResults
  }
}
