import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { serializeBibleChoice } from '../bible-sources/bible-choice-storage'
import type { TranslationChoice } from '../bible-sources/translation-source-select'
import '../bible-sources/translation-source-select'
import type { VerseSource } from '../types'
import { loadRoundCount, saveRoundCount } from '../game-preferences'
import { freshChoice, isReady, nameOf, renderSelector, type GameTypeChoice, type GameTypeId } from '../game-types/registry'
import { buttonStyles } from '../shared-ui/button-styles'

export interface GameOptions {
  translation: string
  verseSource: VerseSource
  roundCount: number
  /** The game type and what was picked for it — see
   * game-types/registry.ts. Always ready to play (see isReady). */
  choice: GameTypeChoice
}

/** What was picked for a game type, and against which Bible — a selection
 * names books in that Bible's own spelling, so it is only restored for
 * the same Bible. `bibleKey` is the Bible's serialized BibleChoice. */
export interface SavedGameTypeChoice {
  choice: GameTypeChoice
  bibleKey: string
}

const MIN_ROUNDS = 3
const MAX_ROUNDS = 10

/**
 * Pre-game screen: choose where verses come from (with the shared Bible
 * picker — a server translation, or a Bible file the player supplies and
 * parses in their own browser, preselected with the remembered choice; see
 * translation-source-select.ts), what the game type needs picked, and how
 * many verses (3-10) the game will run for. Fires a `game-started`
 * CustomEvent<GameOptions> once ready and the player confirms.
 */
@customElement('bg-game-setup')
export class GameSetup extends LitElement {
  /** Which game type this screen is configuring (see mode-select.ts). The
   * game type is fixed for this screen visit; there's no in-screen way to
   * switch it. */
  @property({ attribute: false })
  gameType: GameTypeId = 'the-bible'

  /** What was picked for this game type on an earlier visit, if anything
   * — see bg-app.ts's savedChoices. */
  @property({ attribute: false })
  savedChoice?: SavedGameTypeChoice

  @state()
  private bible?: TranslationChoice

  @state()
  private roundCount = loadRoundCount()

  /** Undefined until a Bible is chosen. Then the saved choice when it was
   * made against this same Bible, otherwise a fresh one — see willUpdate. */
  @state()
  private choice?: GameTypeChoice

  // The Bible the current `choice` belongs to, so willUpdate can tell when
  // the player has switched to a DIFFERENT one and the selection no longer
  // applies — the game types' selectors reset their own internal UI state
  // the same way, keyed off the same change.
  private _lastBibleKey?: string

  render() {
    return html`
      <div class="setup">
        <h1>bibleguessr</h1>
        <p class="tagline">Guess the book, chapter, and verse.</p>

        <bg-translation-source-select
          .serverSource=${api}
          .submitBibleFileReport=${api.submitBibleFileUploadReport}
          @translation-changed=${this._onBibleChanged}
        ></bg-translation-source-select>

        <form @submit=${this._onSubmit}>
          ${this._renderScopeSelector()}

          <label>
            Number of verses
            <div class="round-count">
              <input
                type="range"
                min=${MIN_ROUNDS}
                max=${MAX_ROUNDS}
                .value=${String(this.roundCount)}
                @input=${(e: Event) => this._onRoundCountInput(e)}
              />
              <span class="round-count-value">${this.roundCount}</span>
            </div>
          </label>

          <button type="submit" ?disabled=${!this._canStart}>Start game</button>
        </form>
      </div>
    `
  }

  willUpdate() {
    const bibleKey = this.bible ? serializeBibleChoice(this.bible.bible) : undefined
    if (bibleKey !== this._lastBibleKey) {
      this._lastBibleKey = bibleKey
      // A selection only makes sense for the Bible it was made against:
      // restore the saved one for that same Bible, start fresh otherwise.
      this.choice =
        bibleKey !== undefined && this.savedChoice?.bibleKey === bibleKey
          ? this.savedChoice.choice
          : freshChoice(this.gameType)
    }
  }

  private _onBibleChanged = (event: CustomEvent<TranslationChoice | undefined>) => {
    this.bible = event.detail
  }

  private get _canStart(): boolean {
    // Whether the game type still needs something picked is its own
    // business — see GameTypeDefinition.defaultSelection.
    return !!this.bible && !!this.choice && isReady(this.choice)
  }

  // Undefined until a Bible is chosen, so the game type's selector stays
  // hidden until there's something to select from.
  private _renderScopeSelector() {
    if (!this.bible || !this.choice) return null

    const selector = renderSelector(this.choice, {
      verseSource: this.bible.verseSource,
      translation: this.bible.translation,
      onChange: this._onChoiceChanged,
    })
    if (!selector) return null

    return html`
      <div class="scope-selector-block">
        <span class="scope-selector-label">${nameOf(this.choice.gameType)}</span>
        ${selector}
      </div>
    `
  }

  private _onChoiceChanged = (choice: GameTypeChoice) => {
    this.choice = choice
    if (this._lastBibleKey === undefined) return

    // Re-dispatched as this component's own event so the parent can track
    // the in-progress selection live — not just once the player hits
    // "Start game" — and persist it per game type across visits to this
    // screen, with the Bible it belongs to. See bg-app.ts's savedChoices.
    this.dispatchEvent(
      new CustomEvent<SavedGameTypeChoice>('game-type-choice-changed', {
        detail: { choice, bibleKey: this._lastBibleKey },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _onRoundCountInput(e: Event) {
    this.roundCount = Number((e.target as HTMLInputElement).value)
    saveRoundCount(this.roundCount)
    // Remembered per browser so returning to setup doesn't mean redoing
    // the same choice — see game-preferences.ts.
  }

  private _onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this._canStart) return

    const detail: GameOptions = {
      translation: this.bible!.translation,
      verseSource: this.bible!.verseSource,
      roundCount: this.roundCount,
      choice: this.choice!,
    }

    this.dispatchEvent(
      new CustomEvent<GameOptions>('game-started', {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = [
    buttonStyles,
    css`
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
      color: var(--text-muted);
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

    .scope-selector-block {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.9rem;
      text-align: left;
    }

    .scope-selector-label {
      font-weight: 500;
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
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-game-setup': GameSetup
  }
}
