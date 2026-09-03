import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

export type GameMode = 'singleplayer' | 'multiplayer'

/**
 * The very first screen: choose Singleplayer or Multiplayer. Fires a
 * `mode-selected` CustomEvent<GameMode> once the player picks one.
 */
@customElement('bg-mode-select')
export class ModeSelect extends LitElement {
  render() {
    return html`
      <div class="mode-select">
        <h1>bibleguessr</h1>
        <p class="tagline">Guess the book, chapter, and verse.</p>

        <div class="modes">
          <button type="button" @click=${() => this._select('singleplayer')}>Singleplayer</button>
          <button type="button" @click=${() => this._select('multiplayer')}>Multiplayer</button>
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
      gap: 1.5rem;
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

    .modes {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    button {
      padding: 0.9rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
    }

    button:last-child {
      background: transparent;
      color: #aa3bff;
      border: 1px solid #aa3bff;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-mode-select': ModeSelect
  }
}
