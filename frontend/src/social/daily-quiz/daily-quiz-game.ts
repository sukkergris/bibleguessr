import { LitElement, css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { Guess, VerseSource } from '../../shared-kernel/bible'
import { ANY_BOOK } from '../../shared-kernel/guess-constraint'
import '../../shared-ui/guess-form'
import '../../shared-ui/verse-card'
import { fetchDailyQuiz } from './daily-quiz-client'
import './next-quiz-countdown'
import {
  LOADING,
  advanced,
  failed,
  guessed,
  started,
  totalPoints,
  verseResolved,
  type DailyQuizRound,
  type DailyQuizSession,
} from './daily-quiz-session'

const LOOKUP_FAILED_MESSAGE = "This verse couldn't be loaded."

function formatGuess(guess: Guess): string {
  if (guess.chapter === undefined) return guess.book
  if (guess.verseNumber === undefined) return `${guess.book} ${guess.chapter}`
  return `${guess.book} ${guess.chapter}:${guess.verseNumber}`
}

/**
 * Today's quiz — see docs/web/daily-quiz. Five verses from the whole
 * Bible, the same for every player, new at 00:00 UTC. The flow lives in
 * daily-quiz-session.ts; this component fetches, looks verses up in
 * `verseSource` and renders whichever state the session is in.
 *
 * Fires `daily-quiz-closed` when the player goes back to Social.
 */
@customElement('bg-daily-quiz')
export class DailyQuizGame extends LitElement {
  /** Where each verse's text is looked up — given by the host. */
  @property({ attribute: false })
  verseSource?: VerseSource

  @state()
  private session: DailyQuizSession = LOADING

  // The translation the guess form was last given. Kept between verses so
  // the form doesn't briefly switch book lists (and so jump) while the next
  // verse's text is looked up.
  private translation?: string

  @query('.next')
  private nextButton?: HTMLButtonElement

  connectedCallback() {
    super.connectedCallback()
    this._loadQuiz()
  }

  private _loadQuiz() {
    this.session = LOADING
    fetchDailyQuiz()
      .then((quiz) => {
        this.session = started(quiz)
        this._lookUpCurrentVerse()
      })
      .catch((error: unknown) => {
        this.session = failed(error instanceof Error ? error.message : "Today's quiz couldn't be loaded.")
      })
  }

  updated(changed: Map<string, unknown>) {
    // Once a verse has been answered, the next-verse button takes focus:
    // the guess form it replaces had it, and Enter can then carry on.
    const previous = changed.get('session') as DailyQuizSession | undefined
    const justAnswered =
      this.session.kind === 'playing' && !!this.session.feedback && previous?.kind === 'playing' && !previous.feedback
    if (justAnswered) this.nextButton?.focus()
  }

  private _lookUpCurrentVerse() {
    const session = this.session
    if (session.kind !== 'playing' || !this.verseSource) return
    const { roundIndex } = session
    this.verseSource
      .lookupVerse(session.quiz.verses[roundIndex])
      .then((verse) => {
        this.translation = verse.translation
        this.session = verseResolved(this.session, roundIndex, verse)
      })
      .catch((error: unknown) => {
        console.error('[daily-quiz] failed to look up verse', error)
        this.session = failed(LOOKUP_FAILED_MESSAGE)
      })
  }

  private _onGuess = (event: CustomEvent<Guess>) => {
    this.session = guessed(this.session, event.detail)
  }

  private _onNext = () => {
    this.session = advanced(this.session)
    this._lookUpCurrentVerse()
  }

  private _onBack = () => {
    this.dispatchEvent(new CustomEvent('daily-quiz-closed', { bubbles: true, composed: true }))
  }

  render() {
    const quizDate = this.session.kind === 'playing' || this.session.kind === 'finished' ? this.session.quiz.date : undefined
    return html`
      <section class="daily-quiz">
        <bg-next-quiz-countdown .quizDate=${quizDate} @new-quiz-requested=${() => this._loadQuiz()}></bg-next-quiz-countdown>
        ${this._renderSession()}
      </section>
    `
  }

  private _renderSession() {
    const session = this.session
    switch (session.kind) {
      case 'loading':
        return html`
          <h1>Daily quiz</h1>
          <p role="status">Loading today's quiz…</p>
        `
      case 'failed':
        return html`
          <h1>Daily quiz</h1>
          <p class="error" role="alert">${session.message}</p>
          <button type="button" class="secondary" @click=${this._onBack}>Back to Social</button>
        `
      case 'playing': {
        const isLast = session.roundIndex + 1 >= session.quiz.verses.length
        return html`
          <h1>Daily quiz</h1>
          <p class="meta">
            ${session.quiz.date} ·
            <span role="status">Verse ${session.roundIndex + 1} of ${session.quiz.verses.length}</span>
          </p>
          <bg-verse-card .verse=${session.verse} .revealed=${!!session.feedback}></bg-verse-card>
          ${session.feedback
            ? html`
                ${this._renderFeedback(session.feedback)}
                <button type="button" class="next" @click=${this._onNext}>
                  ${isLast ? 'See results' : 'Next verse'}
                </button>
              `
            : html`
                <bg-guess-form
                  .disabled=${!session.verse}
                  .translation=${this.translation}
                  .verseSource=${this.verseSource}
                  .constraint=${ANY_BOOK}
                  @guess-submitted=${this._onGuess}
                ></bg-guess-form>
              `}
        `
      }
      case 'finished':
        return html`
          <h1>Daily quiz</h1>
          <p class="meta">${session.quiz.date}</p>
          <p class="total">Today's score: ${totalPoints(session.rounds)} points</p>
          <ol class="rounds">
            ${session.rounds.map(
              (round) => html`
                <li>
                  <span>${round.verse.reference}</span>
                  <span class="round-guess">you guessed ${formatGuess(round.guess)}</span>
                  <span class="round-points">${round.points}</span>
                </li>
              `,
            )}
          </ol>
          <button type="button" class="secondary" @click=${this._onBack}>Back to Social</button>
        `
    }
  }

  private _renderFeedback(round: DailyQuizRound) {
    return html`
      <div class="feedback ${round.points > 0 ? 'correct' : 'incorrect'}">
        ${round.points > 0 ? `+${round.points} points` : 'No points'} — you guessed ${formatGuess(round.guess)}, it
        was ${round.verse.reference}.
      </div>
    `
  }

  static styles = css`
    :host {
      display: block;
    }

    /* Bottom space so the round report buttons fixed in the screen's
       corners (see index.css) never cover the last button. */
    .daily-quiz {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding-bottom: calc(var(--corner-button-inset) + var(--corner-button-size));
    }

    h1 {
      font-size: 1.75rem;
      margin: 0;
      text-align: center;
    }

    .meta {
      margin: 0;
      text-align: center;
      color: var(--text-muted);
    }

    .feedback {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    /* Points text says how it went; the colour only backs it up. */
    .feedback.correct {
      background: rgba(34, 197, 94, 0.15);
    }

    .feedback.incorrect {
      background: rgba(239, 68, 68, 0.15);
    }

    .total {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      text-align: center;
    }

    .rounds {
      margin: 0;
      padding-left: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    /* reference | what was guessed | points — the points keep their own
       column however long the guess is. */
    .rounds li {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: baseline;
      gap: 0 0.5rem;
    }

    .round-guess {
      color: var(--text-muted);
    }

    .round-points {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .error {
      color: var(--error);
      text-align: center;
    }

    button {
      padding: 0.7rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 1rem;
      cursor: pointer;
    }

    button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
    }

    button:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-daily-quiz': DailyQuizGame
  }
}
