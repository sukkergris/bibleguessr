import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'

export interface GameOptions {
  translation: string
  roundCount: number
}

const MIN_ROUNDS = 3
const MAX_ROUNDS = 10
const DEFAULT_ROUNDS = 5

/**
 * Pre-game screen: choose a translation and how many verses (3-10) the game
 * will run for. Fires a `game-started` CustomEvent<GameOptions> once both
 * are chosen and the player confirms.
 */
@customElement('bg-game-setup')
export class GameSetup extends LitElement {
  @state()
  private translations: string[] = []

  @state()
  private selectedTranslation = ''

  @state()
  private roundCount = DEFAULT_ROUNDS

  @state()
  private error?: string

  connectedCallback() {
    super.connectedCallback()
    api
      .getTranslations()
      .then((translations) => {
        this.translations = translations
        if (translations.length > 0) {
          this.selectedTranslation = translations[0]
        }
      })
      .catch((err) => {
        this.error = err instanceof Error ? err.message : 'Failed to load translations.'
      })
  }

  render() {
    return html`
      <div class="setup">
        <h1>bibleguessr</h1>
        <p class="tagline">Guess the book, chapter, and verse.</p>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <form @submit=${this._onSubmit}>
          <label>
            Translation
            <select
              .value=${this.selectedTranslation}
              @change=${(e: Event) => (this.selectedTranslation = (e.target as HTMLSelectElement).value)}
              ?disabled=${this.translations.length === 0}
              required
            >
              ${this.translations.length === 0
                ? html`<option value="">Loading…</option>`
                : this.translations.map((t) => html`<option value=${t}>${t}</option>`)}
            </select>
          </label>

          <label>
            Number of verses
            <div class="round-count">
              <input
                type="range"
                min=${MIN_ROUNDS}
                max=${MAX_ROUNDS}
                .value=${String(this.roundCount)}
                @input=${(e: Event) => (this.roundCount = Number((e.target as HTMLInputElement).value))}
              />
              <span class="round-count-value">${this.roundCount}</span>
            </div>
          </label>

          <button type="submit" ?disabled=${!this.selectedTranslation}>Start game</button>
        </form>
      </div>
    `
  }

  private _onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.selectedTranslation) return

    this.dispatchEvent(
      new CustomEvent<GameOptions>('game-started', {
        detail: { translation: this.selectedTranslation, roundCount: this.roundCount },
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    .setup {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .tagline {
      margin: 0;
      color: #6b6375;
    }

    @media (prefers-color-scheme: dark) {
      .tagline {
        color: #9ca3af;
      }
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      margin-top: 0.5rem;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.9rem;
      text-align: left;
    }

    select {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }

    .round-count {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .round-count input[type='range'] {
      flex: 1;
    }

    .round-count-value {
      min-width: 1.5rem;
      text-align: center;
      font-weight: 600;
    }

    button {
      padding: 0.7rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error {
      color: #d33;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-setup': GameSetup
  }
}
