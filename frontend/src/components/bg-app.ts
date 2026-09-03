import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import type { Guess, Verse } from '../types'
import './verse-card'
import './guess-form'

type Feedback = { correct: boolean; verse: Verse } | undefined

@customElement('bg-app')
export class BgApp extends LitElement {
  @state()
  private verse?: Verse

  @state()
  private feedback: Feedback

  @state()
  private score = 0

  @state()
  private error?: string

  connectedCallback() {
    super.connectedCallback()
    this.addEventListener('guess-submitted', this._onGuessSubmitted as EventListener)
    void this._loadNextVerse()
  }

  private async _loadNextVerse() {
    this.error = undefined
    this.feedback = undefined
    try {
      this.verse = await api.getRandomVerse()
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load a verse.'
    }
  }

  private _onGuessSubmitted = (event: CustomEvent<Guess>) => {
    if (!this.verse) return

    const guess = event.detail
    const bookMatches = guess.book.trim().toLowerCase() === this.verse.book.trim().toLowerCase()
    const chapterMatches = guess.chapter === undefined || guess.chapter === this.verse.chapter
    const correct = bookMatches && chapterMatches

    if (correct) {
      this.score += 1
    }

    this.feedback = { correct, verse: this.verse }
  }

  render() {
    return html`
      <main>
        <header>
          <h1>bibleguessr</h1>
          <p class="score">Score: ${this.score}</p>
        </header>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <bg-verse-card .verse=${this.verse} .revealed=${!!this.feedback}></bg-verse-card>

        ${this.feedback
          ? html`
              <div class="feedback ${this.feedback.correct ? 'correct' : 'incorrect'}">
                ${this.feedback.correct ? '✓ Correct!' : '✗ Not quite.'} It was
                ${this.feedback.verse.reference}.
              </div>
              <button class="next" @click=${this._loadNextVerse}>Next verse</button>
            `
          : html`<bg-guess-form .disabled=${!this.verse} .translation=${this.verse?.translation}></bg-guess-form>`}
      </main>
    `
  }

  static styles = css`
    :host {
      display: block;
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem 1rem;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 1.5rem;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .score {
      font-weight: 600;
      margin: 0;
    }

    .error {
      color: #d33;
    }

    .feedback {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-weight: 600;
    }

    .feedback.correct {
      background: rgba(34, 197, 94, 0.15);
      color: #16a34a;
    }

    .feedback.incorrect {
      background: rgba(239, 68, 68, 0.15);
      color: #dc2626;
    }

    .next {
      margin-top: 1rem;
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-app': BgApp
  }
}
