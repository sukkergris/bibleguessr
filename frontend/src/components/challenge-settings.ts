import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  loadEpilepsyStressModeEnabled,
  saveEpilepsyStressModeEnabled,
} from '../flash-intensity-storage';
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
  verseSource?: VerseSource;

  @property({ attribute: false })
  translation?: string;

  @state()
  private scope: GameTypeScope = 'all';

  @state()
  private restriction?: VerseRestriction;

  @state()
  private roundCount = DEFAULT_ROUNDS;

  @state()
  private timeLimitSeconds: number | undefined = undefined;

  // Local-only, per-device/per-player preference — deliberately NOT part
  // of ChallengeSettings/_emitChange below, since it's never sent to the
  // server or shared with the opponent, and has nothing to do with round
  // rules the two players agree on (see flash-intensity-storage.ts). Read
  // straight from storage on construction so a returning player's choice
  // is remembered. false (unchecked) is the safe default — see
  // "Enter epilepsy-inducing stress mode" below: checking it OPTS INTO the
  // faster, less-safe blink rate (multiplayer-game.ts's
  // _dangerAnimationSeconds), it does not remove/reduce anything.
  @state()
  private epilepsyStressModeEnabled = loadEpilepsyStressModeEnabled();

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
            <span class="slider-value">
              ${this.timeLimitSeconds === undefined
                ? 'No limit'
                : `${this.timeLimitSeconds}s`}
            </span>
          </div>
        </label>

        <label class="checkbox-row stress-mode-row">
          <span class="toggle-switch">
            <input
              type="checkbox"
              .checked=${this.epilepsyStressModeEnabled}
              @change=${this._onEpilepsyStressModeChanged}
            />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </span>
          <span class="stress-mode-label">
            ⚡ Enter epilepsy-inducing stress mode 🔥
          </span>
        </label>
      </div>
    `;
  }

  private _onGameTypeChanged(
    event: CustomEvent<{ scope: GameTypeScope; restriction?: VerseRestriction }>
  ) {
    this.scope = event.detail.scope;
    this.restriction = event.detail.restriction;
    this._emitChange();
  }

  private _onRoundCountInput(e: Event) {
    this.roundCount = Number((e.target as HTMLInputElement).value);
    this._emitChange();
  }

  private _onTimeLimitInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    // 1 second is clamped up to 2 — a genuinely 1-second round is
    // degenerate (see docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md's
    // countdown-blink threshold, which separately skips the blink for
    // any round ≤5s anyway). MIN_TIME_LIMIT_SECONDS stays 0 as the
    // distinct "unlimited" sentinel — only the timed range's practical
    // floor moves. The slider itself still visually has a notch at 1
    // (a plain range input can't skip a single step), but this handler
    // means it's never actually reachable as a value — and since
    // .value=${String(this.timeLimitSeconds ?? 0)} binds the slider's
    // position back to this field, the thumb visually snaps to 2 too.
    this.timeLimitSeconds = value === 0 ? undefined : value === 1 ? 2 : value;
    this._emitChange();
  }

  // No _emitChange() call here — deliberately, unlike every other handler
  // above. This is a local-only preference (see the field's own doc
  // comment and flash-intensity-storage.ts); it must never reach
  // ChallengeSettings/the server/the opponent, so it's persisted directly
  // to localStorage instead of flowing through challenge-settings-changed.
  private _onEpilepsyStressModeChanged(e: Event) {
    this.epilepsyStressModeEnabled = (e.target as HTMLInputElement).checked;
    saveEpilepsyStressModeEnabled(this.epilepsyStressModeEnabled);
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
      })
    );
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

    /* Overrides the base label rule's flex-direction: column — a
       checkbox reads left-to-right alongside its own text, not stacked
       above/below it like the sliders' label/value pairs. */
    .checkbox-row {
      flex-direction: row;
      align-items: center;
      gap: 0.5rem;
    }

    /* A custom-styled switch, not the bare native checkbox — the real
       <input type="checkbox"> stays in the DOM for actual state,
       keyboard operation (Space/Enter, Tab focus) and screen readers;
       it's only visually hidden (opacity:0, not display:none/hidden,
       which would break both focus and screen readers), sized to
       exactly cover the track so its native hit target/focus ring still
       lines up with what's drawn. .toggle-track/.toggle-thumb are what
       actually renders; :checked + .toggle-track reads the real input's
       state via a plain CSS sibling selector, no JS needed for the
       visual side at all. */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 2.75rem;
      height: 1.5rem;
      flex-shrink: 0;
    }

    .toggle-switch input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: pointer;
      z-index: 1;
    }

    .toggle-track {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: #9ca3af;
      transition: background-color 0.2s ease;
    }

    .toggle-thumb {
      position: absolute;
      top: 0.15rem;
      left: 0.15rem;
      width: 1.2rem;
      height: 1.2rem;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      transition: transform 0.2s ease;
    }

    .toggle-switch input:checked + .toggle-track {
      background: linear-gradient(90deg, #f97316, #dc2626, #db2777);
    }

    .toggle-switch input:checked + .toggle-track .toggle-thumb {
      transform: translateX(1.25rem);
    }

    .toggle-switch input:focus-visible + .toggle-track {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    /* Deliberately loud/playful — this toggle is genuinely different in
       kind from the sliders above it (it's an explicit opt-in past a
       real safety guideline, see multiplayer-game.ts's
       _dangerAnimationSeconds), so it's styled to stand out rather than
       blend in as just another quiet settings row. The animation here
       is a slow, continuous hue-rotate + gentle wobble — NOT a flash or
       strobe: this control is specifically about a photosensitivity
       feature, so it would be a real problem for it to itself flicker.
       prefers-reduced-motion still turns the motion off entirely,
       leaving just the gradient/border styling. */
    .stress-mode-label {
      display: inline-block;
      padding: 0.4rem 0.75rem;
      border-radius: 999px;
      border: 2px dashed #f97316;
      background: linear-gradient(90deg, #f97316, #dc2626, #db2777, #f97316);
      background-size: 300% 100%;
      color: #fff;
      font-weight: 700;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      animation:
        stress-mode-gradient 4s linear infinite,
        stress-mode-wobble 2.5s ease-in-out infinite;
    }

    @keyframes stress-mode-gradient {
      to {
        background-position: 300% 0;
      }
    }

    @keyframes stress-mode-wobble {
      0%,
      100% {
        transform: rotate(-1deg);
      }
      50% {
        transform: rotate(1deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .stress-mode-label {
        animation: none;
        background: #dc2626;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-challenge-settings': ChallengeSettingsSelect
  }
}
