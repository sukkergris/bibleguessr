import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

// Singleplayer is split into three separate game types, chosen up front —
// see docs/SCRUM/Feature.BibleSelector.md. Each is its own entry point
// (rather than a single "setup" screen with a mode dropdown inside it) so
// each one's book/chapter selection can persist independently — see
// bg-app.ts's allRestriction/booksRestriction/chapterRestriction state.
export type GameMode = 'singleplayer-all' | 'singleplayer-books' | 'singleplayer-chapters' | 'multiplayer'

/**
 * The very first screen: choose a game type. Fires a `mode-selected`
 * CustomEvent<GameMode> once the player picks one.
 */
@customElement('bg-mode-select')
export class ModeSelect extends LitElement {
  render() {
    return html`
      <div class="mode-select">
        <h1>bibleguessr</h1>
        <p class="tagline">Guess the book, chapter, and verse.</p>

        <div class="group">
          <h2>Singleplayer</h2>
          <div class="modes">
            <button type="button" @click=${() => this._select('singleplayer-all')}>
              The Bible <span class="hint">quiz on any verse</span>
            </button>
            <button type="button" @click=${() => this._select('singleplayer-books')}>
              Books <span class="hint">choose which books to use</span>
            </button>
            <button type="button" @click=${() => this._select('singleplayer-chapters')}>
              Chapters <span class="hint">choose chapters in one book</span>
            </button>
          </div>
        </div>

        <div class="group">
          <h2>Multiplayer</h2>
          <div class="modes">
            <button type="button" class="secondary" @click=${() => this._select('multiplayer')}>Multiplayer</button>
          </div>
        </div>
      </div>
    `
  }

  private _select(mode: GameMode) {
    this.dispatchEvent(
      new CustomEvent<GameMode>('mode-selected', {
        detail: mode,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    .mode-select {
      display: flex;
      flex-direction: column;
      gap: 1.75rem;
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .tagline {
      margin: 0 0 0.5rem;
      color: var(--text-muted);
    }


    .group {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    h2 {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      text-align: left;
    }


    .modes {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.15rem;
      padding: 0.9rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 1.1rem;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    .hint {
      font-size: 0.8rem;
      font-weight: 400;
      opacity: 0.85;
    }

    button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-mode-select': ModeSelect
  }
}
