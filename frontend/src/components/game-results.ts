import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { Guess, RoundResult } from '../types'

const MAX_POINTS_PER_ROUND = 1110 // book (10) + chapter (100) + verse (1000)

/**
 * End-of-game summary: total score, a per-round breakdown, and a "Copy
 * result" button that builds a TimeGuessr-style shareable text block
 * (an emoji score bar per round, no external link).
 */
@customElement('bg-game-results')
export class GameResults extends LitElement {
  @property({ attribute: false })
  rounds: RoundResult[] = []

  @state()
  private copied = false

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
          <button class="copy" @click=${this._copyResult}>${this.copied ? 'Copied!' : 'Copy result'}</button>
          <button class="again" @click=${this._onPlayAgain}>Play again</button>
        </div>
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

  private _resultText(): string {
    const lines = this.rounds.map((r) => {
      const bookRight = r.points >= 10
      const chapterRight = r.points >= 110
      const verseRight = r.points >= 1110
      return `${bookRight ? '📖' : '❌'}${chapterRight ? '📄' : ''}${verseRight ? '🔢' : ''} ${r.points} pts`
    })

    return [`bibleguessr — ${this.totalScore}/${this.maxScore}`, ...lines].join('\n')
  }

  private async _copyResult() {
    try {
      await navigator.clipboard.writeText(this._resultText())
      this.copied = true
      setTimeout(() => (this.copied = false), 2000)
    } catch (error) {
      console.error('[game-results] failed to copy result', error)
    }
  }

  private _onPlayAgain() {
    this.dispatchEvent(new CustomEvent('play-again', { bubbles: true, composed: true }))
  }

  static styles = css`
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
      color: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      .max {
        color: #9ca3af;
      }
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
      color: #6b6375;
      min-width: 1.75rem;
    }

    @media (prefers-color-scheme: dark) {
      .round-num {
        color: #9ca3af;
      }
    }

    .reference {
      flex: 1;
    }

    .points {
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    button {
      flex: 1;
      padding: 0.7rem 1.25rem;
      border-radius: 8px;
      border: none;
      font-size: 1rem;
      cursor: pointer;
    }

    .copy {
      background: rgba(170, 59, 255, 0.12);
      color: #aa3bff;
    }

    .again {
      background: #aa3bff;
      color: white;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-results': GameResults
  }
}
