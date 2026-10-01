import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { buttonStyles } from '../../shared-ui/button-styles'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE
const TICK_MS = MS_PER_SECOND
const TWO_DIGITS = 2

/** Seconds until the next quiz, which the server makes at 00:00 UTC (see
 * docs/web/daily-quiz). Rounded up, so it never reaches 00:00:00 early. */
export function secondsUntilNextQuiz(now: Date): number {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.ceil((nextMidnight - now.getTime()) / MS_PER_SECOND)
}

/** HH:MM:SS. */
export function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return [hours, minutes, seconds].map((part) => String(part).padStart(TWO_DIGITS, '0')).join(':')
}

/** The UTC day of `now`, written yyyy-MM-dd like a quiz's date. */
export function utcDateOf(now: Date): string {
  return now.toISOString().slice(0, 'yyyy-mm-dd'.length)
}

/**
 * Counts down to the next daily quiz. Once the day has moved past
 * `quizDate` (the quiz the player has open), it says a new one is ready
 * and offers a button — never swapping the quiz itself, so a game in
 * progress is never interrupted. Fires `new-quiz-requested` from that
 * button.
 *
 * role="timer" is deliberately not announced on every tick (its implicit
 * aria-live is off): a screen reader reads it when the player gets to it.
 */
@customElement('bg-next-quiz-countdown')
export class NextQuizCountdown extends LitElement {
  /** The date (yyyy-MM-dd) of the quiz on screen, once there is one. */
  @property({ type: String })
  quizDate?: string

  @state()
  private now = new Date()

  private timer?: ReturnType<typeof setInterval>

  connectedCallback() {
    super.connectedCallback()
    this.timer = setInterval(() => (this.now = new Date()), TICK_MS)
  }

  disconnectedCallback() {
    clearInterval(this.timer)
    super.disconnectedCallback()
  }

  render() {
    const newQuizReady = !!this.quizDate && utcDateOf(this.now) > this.quizDate
    if (newQuizReady) {
      return html`
        <div class="countdown">
          <p role="timer">A new quiz is ready.</p>
          <button type="button" class="compact secondary" @click=${this._onPlayNewQuiz}>Play the new quiz</button>
        </div>
      `
    }
    return html`
      <div class="countdown">
        <p role="timer">Next quiz in ${formatCountdown(secondsUntilNextQuiz(this.now))}</p>
      </div>
    `
  }

  private _onPlayNewQuiz = () => {
    this.dispatchEvent(new CustomEvent('new-quiz-requested', { bubbles: true, composed: true }))
  }

  static styles = [
    buttonStyles,
    css`
    :host {
      display: block;
    }

    .countdown {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.5rem 0.75rem;
      font-size: 0.9rem;
      color: var(--text-muted);
    }

    p {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }


  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-next-quiz-countdown': NextQuizCountdown
  }
}
