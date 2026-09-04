import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { GameTypeScope } from '../game-type'
import type { VerseRestriction, VerseSource } from '../types'
import './book-selector'
import './chapter-selector'
import type { ChapterSelection } from './chapter-selector'

/**
 * Lets the challenger choose which verses a game they challenge someone to
 * will draw from — All / Books / Chapters, same vocabulary and selector
 * components as the singleplayer setup screen (see game-setup.ts's
 * SetupScope). Sits above the players list in the room screen (see
 * bg-room-setup.ts) — the challenger picks a type here once, then clicking
 * a player's name in the list sends a challenge for whatever's currently
 * selected (see docs/SCRUM/Feature.RequestToStartMPGame.md).
 *
 * Fires `game-type-changed` CustomEvent<{scope, restriction}> whenever the
 * selection changes, mirroring game-setup.ts's scope-restriction-changed.
 * The parent (bg-room-setup.ts) owns turning this into an actual GameType
 * to send — see game-type.ts's gameTypeFromRestriction.
 */
@customElement('bg-game-type-select')
export class GameTypeSelect extends LitElement {
  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  @state()
  private scope: GameTypeScope = 'all'

  @state()
  private restriction?: VerseRestriction

  render() {
    return html`
      <div class="panel">
        <h2>Game type</h2>
        <div class="scopes" role="tablist">
          ${(['all', 'books', 'chapters'] as GameTypeScope[]).map(
            (scope) => html`
              <button
                type="button"
                role="tab"
                aria-selected=${this.scope === scope}
                class=${this.scope === scope ? 'active' : ''}
                @click=${() => this._onScopeSelected(scope)}
              >
                ${scope === 'all' ? 'All' : scope === 'books' ? 'Books' : 'Chapters'}
              </button>
            `,
          )}
        </div>

        ${this.scope !== 'all' && this.verseSource
          ? html`
              <div class="selector">
                ${this.scope === 'books'
                  ? html`
                      <bg-book-selector
                        .verseSource=${this.verseSource}
                        .translation=${this.translation}
                        .initialSelection=${this.restriction?.books}
                        @restriction-changed=${this._onRestrictionChanged}
                      ></bg-book-selector>
                    `
                  : html`
                      <bg-chapter-selector
                        .verseSource=${this.verseSource}
                        .translation=${this.translation}
                        .initialSelection=${this._initialChapterSelection()}
                        @restriction-changed=${this._onRestrictionChanged}
                      ></bg-chapter-selector>
                    `}
              </div>
            `
          : null}
      </div>
    `
  }

  private _initialChapterSelection(): ChapterSelection | undefined {
    const book = this.restriction?.books[0]
    if (!book) return undefined
    return { book, chapters: this.restriction?.chaptersByBook[book] ?? [] }
  }

  private _onScopeSelected(scope: GameTypeScope) {
    this.scope = scope
    this.restriction = undefined
    this._emitChange()
  }

  private _onRestrictionChanged(event: CustomEvent<VerseRestriction | undefined>) {
    this.restriction = event.detail
    this._emitChange()
  }

  private _emitChange() {
    this.dispatchEvent(
      new CustomEvent<{ scope: GameTypeScope; restriction?: VerseRestriction }>('game-type-changed', {
        detail: { scope: this.scope, restriction: this.restriction },
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
      padding: 0.4rem 0.6rem;
      border-radius: 999px;
      border: 1px solid #ccc;
      background: transparent;
      color: #2b2630;
      font-size: 0.85rem;
      cursor: pointer;
    }

    @media (prefers-color-scheme: dark) {
      .scopes button {
        color: #e5e1ea;
      }
    }

    .scopes button.active {
      background: #aa3bff;
      border-color: #aa3bff;
      color: white;
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
