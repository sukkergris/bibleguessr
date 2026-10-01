import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { GAME_TYPE_IDS, freshChoice, nameOf, renderSelector, type GameTypeChoice, type GameTypeId } from '../game-types/registry'
import type { VerseSource } from '../types'

/**
 * Lets the challenger choose which verses a game they challenge someone to
 * will draw from — one tab per game type, with the same names and selectors
 * as the singleplayer setup screen (both come from game-types/registry.ts). Sits above the players list in the room screen (see
 * bg-room-setup.ts) — the challenger picks a type here once, then clicking
 * a player's name in the list sends a challenge for whatever's currently
 * selected (see docs/SCRUM/Feature.RequestToStartMPGame.md).
 *
 * Fires `game-type-changed` CustomEvent<GameTypeChoice> whenever the
 * selection changes, mirroring game-setup.ts's game-type-choice-changed.
 * The parent (bg-room-setup.ts) owns turning this into an actual GameType
 * to send — see game-types/registry.ts's toWire.
 */
@customElement('bg-game-type-select')
export class GameTypeSelect extends LitElement {
  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  @state()
  private choice: GameTypeChoice = freshChoice('the-bible')

  render() {
    return html`
      <div class="panel">
        <h2>Game type</h2>
        <div class="scopes" role="tablist">
          ${GAME_TYPE_IDS.map(
            (gameType) => html`
              <button
                type="button"
                role="tab"
                aria-selected=${this.choice.gameType === gameType}
                class=${this.choice.gameType === gameType ? 'active' : ''}
                @click=${() => this._onGameTypeSelected(gameType)}
              >
                ${nameOf(gameType)}
              </button>
            `,
          )}
        </div>

        ${this._renderSelector()}
      </div>
    `
  }

  private _renderSelector() {
    if (!this.verseSource) return null
    const selector = renderSelector(this.choice, {
      verseSource: this.verseSource,
      translation: this.translation,
      onChange: (choice) => {
        this.choice = choice
        this._emitChange()
      },
    })
    return selector ? html`<div class="selector">${selector}</div>` : null
  }

  private _onGameTypeSelected(gameType: GameTypeId) {
    this.choice = freshChoice(gameType)
    this._emitChange()
  }

  private _emitChange() {
    this.dispatchEvent(
      new CustomEvent<GameTypeChoice>('game-type-changed', {
        detail: this.choice,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    h2 {
      font-size: 1rem;
      margin: 0 0 0.5rem;
    }

    .scopes {
      display: flex;
      gap: 0.4rem;
    }

    .scopes button {
      flex: 1;
      /* Same size as the Server/File tabs (game-setup.ts,
         translation-source-select.ts). */
      padding: 0.5rem 0.75rem;
      border-radius: 999px;
      border: 1px solid #ccc;
      background: transparent;
      /* The unselected control sits on the page surface, so it takes the
         foreground token. --surface-raised here rendered white-on-white in
         light theme and dark-on-dark in dark theme, hiding the label. */
      color: var(--text);
      font-size: 0.85rem;
      cursor: pointer;
    }


    .scopes button.active {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-text);
    }

    .selector {
      margin-top: 0.6rem;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-type-select': GameTypeSelect
  }
}
