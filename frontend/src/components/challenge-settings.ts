import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { GameTypeScope } from '../game-type'
import type { VerseRestriction, VerseSource } from '../types'
import './game-type-select'

const MIN_ROUNDS = 3
const MAX_ROUNDS = 10
const DEFAULT_ROUNDS = 5

// The time-limit slider's range, in seconds — 0 is the sentinel for "no
// limit" (the slider's default position), matching
// docs/SCRUM/Feature.Time.md's "should default to unlimited". 60 is the
// slider's other end ("1 min"), per the same spec.
const MIN_TIME_LIMIT_SECONDS = 0
const MAX_TIME_LIMIT_SECONDS = 60

export interface ChallengeSettings {
  scope: GameTypeScope
  restriction?: VerseRestriction
  roundCount: number
  /** undefined means "no limit" — see MIN_TIME_LIMIT_SECONDS. */
  timeLimitSeconds?: number
}

/**
 * Everything a challenger picks before sending a play request — wraps the
 * existing <bg-game-type-select> (All/Books/Chapters) with two more
 * sliders: how many rounds, and a per-verse time limit (see
 * docs/SCRUM/Feature.Time.md). Sits above the players list in the room
 * screen — see bg-room-setup.ts.
 *
 * Fires `challenge-settings-changed` CustomEvent<ChallengeSettings>
 * whenever any part of the selection changes.
 */
@customElement('bg-challenge-settings')
export class ChallengeSettingsSelect extends LitElement {
  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  @state()
  private scope: GameTypeScope = 'all'

  @state()
  private restriction?: VerseRestriction

  @state()
  private roundCount = DEFAULT_ROUNDS

  @state()
  private timeLimitSeconds: number | undefined = undefined

  render() {
    return html`
      <div class="panel">
        <bg-game-type-select
          .verseSource=${this.verseSource}
          .translation=${this.translation}
          @game-type-changed=${this._onGameTypeChanged}
        ></bg-game-type-select>

        <label>
          Number of rounds
          <div class="slider-row">
            <input
              type="range"
              min=${MIN_ROUNDS}
              max=${MAX_ROUNDS}
              .value=${String(this.roundCount)}
              @input=${this._onRoundCountInput}
            />
            <span class="slider-value">${this.roundCount}</span>
          </div>
        </label>

        <label>
          Time per verse
          <div class="slider-row">
            <input
              type="range"
              min=${MIN_TIME_LIMIT_SECONDS}
              max=${MAX_TIME_LIMIT_SECONDS}
              .value=${String(this.timeLimitSeconds ?? 0)}
              @input=${this._onTimeLimitInput}
            />
            <span class="slider-value">${this.timeLimitSeconds === undefined ? 'No limit' : `${this.timeLimitSeconds}s`}</span>
          </div>
        </label>
      </div>
    `
  }

  private _onGameTypeChanged(event: CustomEvent<{ scope: GameTypeScope; restriction?: VerseRestriction }>) {
    this.scope = event.detail.scope
    this.restriction = event.detail.restriction
    this._emitChange()
  }

  private _onRoundCountInput(e: Event) {
    this.roundCount = Number((e.target as HTMLInputElement).value)
    this._emitChange()
  }

  private _onTimeLimitInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value)
    this.timeLimitSeconds = value === 0 ? undefined : value
    this._emitChange()
  }

  private _emitChange() {
    this.dispatchEvent(
      new CustomEvent<ChallengeSettings>('challenge-settings-changed', {
        detail: {
          scope: this.scope,
          restriction: this.restriction,
          roundCount: this.roundCount,
          timeLimitSeconds: this.timeLimitSeconds,
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.85rem;
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .slider-row input[type='range'] {
      flex: 1;
    }

    .slider-value {
      min-width: 4rem;
      text-align: right;
      font-weight: 600;
      font-size: 0.85rem;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-challenge-settings': ChallengeSettingsSelect
  }
}
