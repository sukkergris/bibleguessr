import { LitElement, css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { SubmitBibleFileReport } from '../../bible-sources/server-access'
import '../../bible-sources/translation-source-select'
import type { TranslationChoice } from '../../bible-sources/translation-source-select'
import type { Guess, VerseReference, VerseSource } from '../../shared-kernel/bible'
import { ANY_BOOK } from '../../shared-kernel/guess-constraint'
import { buttonStyles } from '../../shared-ui/button-styles'
import { SHARE_OUTCOME_MESSAGES, gameUrl, shareOrCopy } from '../../shared-ui/share-or-copy'
import '../../shared-ui/guess-form'
import '../../shared-ui/verse-card'
import { fetchDailyQuiz } from './daily-quiz-client'
import { shareText } from './daily-quiz-share'
import './next-quiz-countdown'
import {
  CHOOSING_BIBLE,
  LOADING,
  advanced,
  failed,
  guessed,
  skipped,
  started,
  totalPoints,
  verseResolved,
  verseUnavailable,
  type DailyQuizRound,
  type DailyQuizSession,
} from './daily-quiz-session'


function formatReference(reference: VerseReference): string {
  return `${reference.book} ${reference.chapter}:${reference.verseNumber}`
}

function formatGuess(guess: Guess): string {
  if (guess.chapter === undefined) return guess.book
  if (guess.verseNumber === undefined) return `${guess.book} ${guess.chapter}`
  return `${guess.book} ${guess.chapter}:${guess.verseNumber}`
}

/**
 * Today's quiz — see docs/web/daily-quiz. Five verses from the whole
 * Bible, the same for every player, new at 00:00 UTC. The player first
 * chooses the Bible to play from — a server translation or their own
 * file — with the same picker as multiplayer. The flow lives in
 * daily-quiz-session.ts; this component fetches, looks verses up in the
 * chosen Bible and renders whichever state the session is in.
 *
 * Fires `daily-quiz-closed` when the player goes back to Social.
 */
@customElement('bg-daily-quiz')
export class DailyQuizGame extends LitElement {
  /** The server's translations — handed in by the host (see
   * bible-sources/server-access.ts). */
  @property({ attribute: false })
  serverSource?: VerseSource

  /** Where a problem report about an unusable Bible file is sent. */
  @property({ attribute: false })
  submitBibleFileReport?: SubmitBibleFileReport

  /** The link a shared result ends with — the quiz's own address, so
   * whoever follows it lands straight in the quiz. The site's address
   * when not given. */
  @property({ attribute: false })
  shareUrl?: string

  @state()
  private session: DailyQuizSession = CHOOSING_BIBLE

  /** The Bible picked in the picker — undefined until it has a valid one. */
  @state()
  private choice?: TranslationChoice

  /** What sharing the result last did, for the status line under the
   * button — undefined until the player shares. */
  @state()
  private shareStatus?: string

  @query('.next')
  private nextButton?: HTMLButtonElement

  private _onBibleChosen = (event: CustomEvent<TranslationChoice | undefined>) => {
    this.choice = event.detail
  }

  private _onStart = () => {
    if (this.choice) this._loadQuiz()
  }

  private _loadQuiz() {
    this.session = LOADING
    this.shareStatus = undefined
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
    const choice = this.choice
    if (session.kind !== 'playing' || !choice) return
    const { roundIndex } = session
    choice.verseSource
      .lookupVerse(session.quiz.verses[roundIndex], choice.translation)
      .then((verse) => (this.session = verseResolved(this.session, roundIndex, verse)))
      // The chosen Bible doesn't have this verse — e.g. a player's own
      // file with a different verse numbering. The verse can be skipped.
      .catch((error: unknown) => {
        console.warn('[daily-quiz] verse not in the chosen Bible', error)
        this.session = verseUnavailable(this.session, roundIndex)
      })
  }

  private _onSkip = () => {
    this.session = skipped(this.session)
  }

  private _onGuess = (event: CustomEvent<Guess>) => {
    this.session = guessed(this.session, event.detail)
  }

  private _onNext = () => {
    this.session = advanced(this.session, new Date())
    this._lookUpCurrentVerse()
  }

  private _onShare = async () => {
    const session = this.session
    if (session.kind !== 'finished') return
    const text = shareText(
      { quizDate: session.quiz.date, rounds: session.rounds, finishedAt: session.finishedAt },
      this.shareUrl ?? gameUrl(),
    )
    const outcome = await shareOrCopy(text)
    if (outcome !== 'canceled') this.shareStatus = SHARE_OUTCOME_MESSAGES[outcome]
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
      case 'choosing-bible':
        return html`
          <h1>Daily quiz</h1>
          <p class="intro">Choose the Bible to play today's quiz from.</p>
          <bg-translation-source-select
            .serverSource=${this.serverSource}
            .submitBibleFileReport=${this.submitBibleFileReport}
            @translation-changed=${this._onBibleChosen}
          ></bg-translation-source-select>
          <button type="button" class="start" ?disabled=${!this.choice} @click=${this._onStart}>
            Start today's quiz
          </button>
        `
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
          ${session.current.kind === 'unavailable'
            ? html`<p class="unavailable">This verse isn't in your Bible.</p>`
            : html`
                <bg-verse-card
                  .verse=${session.current.kind === 'shown' ? session.current.verse : undefined}
                  .revealed=${!!session.feedback}
                ></bg-verse-card>
              `}
          ${session.feedback
            ? html`
                ${this._renderFeedback(session.feedback)}
                <button type="button" class="next" @click=${this._onNext}>
                  ${isLast ? 'See results' : 'Next verse'}
                </button>
              `
            : session.current.kind === 'unavailable'
              ? html`<button type="button" class="secondary" @click=${this._onSkip}>Skip this verse</button>`
              : html`
                  <bg-guess-form
                    .disabled=${session.current.kind !== 'shown'}
                    .translation=${this.choice?.translation}
                    .verseSource=${this.choice?.verseSource}
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
                  ${round.kind === 'answered'
                    ? html`
                        <span>${round.verse.reference}</span>
                        <span class="round-guess">you guessed ${formatGuess(round.guess)}</span>
                      `
                    : html`
                        <span>${formatReference(round.reference)}</span>
                        <span class="round-guess">not in your Bible</span>
                      `}
                  <span class="round-points">${round.points}</span>
                </li>
              `,
            )}
          </ol>
          <button type="button" @click=${this._onShare}>Share result</button>
          <p class="share-status" role="status">${this.shareStatus ?? ''}</p>
          <button type="button" class="secondary" @click=${this._onBack}>Back to Social</button>
        `
    }
  }

  private _renderFeedback(round: DailyQuizRound) {
    if (round.kind === 'unavailable') {
      return html`
        <div class="feedback incorrect">
          Skipped — ${formatReference(round.reference)} isn't in your Bible. No points.
        </div>
      `
    }
    return html`
      <div class="feedback ${round.points > 0 ? 'correct' : 'incorrect'}">
        ${round.points > 0 ? `+${round.points} points` : 'No points'} — you guessed ${formatGuess(round.guess)}, it
        was ${round.verse.reference}.
      </div>
    `
  }

  static styles = [
    buttonStyles,
    css`
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

    .intro,
    .unavailable {
      margin: 0;
      text-align: center;
    }

    .unavailable {
      padding: 2rem 1rem;
      border-radius: 12px;
      border: 1px dashed var(--border);
      color: var(--text-muted);
    }


    .feedback {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    /* Points text says how it went; the color only backs it up. */
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

    .share-status {
      margin: 0;
      min-height: 1.2em;
      text-align: center;
      font-size: 0.9rem;
      color: var(--text-muted);
    }

    .error {
      color: var(--error);
      text-align: center;
    }



  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-daily-quiz': DailyQuizGame
  }
}
