import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { Guess } from '../types'

/**
 * Fires a `guess-submitted` CustomEvent<Guess> when the player submits.
 */
@customElement('bg-guess-form')
export class GuessForm extends LitElement {
  @property({ type: Boolean })
  disabled = false

  @state()
  private book = ''

  @state()
  private chapter = ''

  render() {
    return html`
      <form @submit=${this._onSubmit}>
        <label>
          Book
          <input
            type="text"
            placeholder="e.g. Salme"
            .value=${this.book}
            @input=${(e: Event) => (this.book = (e.target as HTMLInputElement).value)}
            ?disabled=${this.disabled}
            required
          />
        </label>
        <label>
          Chapter (optional)
          <input
            type="number"
            min="1"
            .value=${this.chapter}
            @input=${(e: Event) => (this.chapter = (e.target as HTMLInputElement).value)}
            ?disabled=${this.disabled}
          />
        </label>
        <button type="submit" ?disabled=${this.disabled}>Guess</button>
      </form>
    `
  }

  private _onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.book.trim()) return

    const guess: Guess = {
      book: this.book.trim(),
      chapter: this.chapter ? Number(this.chapter) : undefined,
    }

    this.dispatchEvent(
      new CustomEvent<Guess>('guess-submitted', {
        detail: guess,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: flex-end;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.9rem;
    }

    input {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }

    button {
      padding: 0.6rem 1.25rem;
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
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-guess-form': GuessForm
  }
}
