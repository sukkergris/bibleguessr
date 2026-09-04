import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import type { Guess, RoundResult, Verse, VerseSource } from '../types'
import './verse-card'
import './guess-form'
import './game-setup'
import type { GameOptions } from './game-setup'
import './game-results'
import './mode-select'
import type { GameMode } from './mode-select'
import './bg-room-setup'
import './connection-status'
import './nerd-panel'

type Feedback = { points: number; verse: Verse; guess: Guess } | undefined

// Points awarded per level of a guess, gated on every level before it being
// correct — mirrors backend/Domain/Game.fs's Scoring.pointsForVerseGuess.
const BOOK_POINTS = 10
const CHAPTER_POINTS = 100
const VERSE_NUMBER_POINTS = 1000

type GamePhase = 'mode-select' | 'setup' | 'playing' | 'gameOver' | 'room-setup'

@customElement('bg-app')
export class BgApp extends LitElement {
  @state()
  private phase: GamePhase = 'mode-select'

  @state()
  private translation = ''

  // Where verses/books come from for the game in progress: the backend
  // (default) or a Bible file the player parsed client-side — see
  // local-verses.ts. Chosen per game by bg-game-setup.
  @state()
  private verseSource: VerseSource = api

  @state()
  private roundCount = 0

  @state()
  private roundIndex = 0

  @state()
  private verse?: Verse

  @state()
  private feedback: Feedback

  @state()
  private rounds: RoundResult[] = []

  @state()
  private error?: string

  private get score() {
    return this.rounds.reduce((sum, r) => sum + r.points, 0)
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('keydown', this._onKeydown)
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeydown)
    super.disconnectedCallback()
  }

  // While the "Next verse"/"See results" button is showing, Enter activates
  // it — mirrors what Enter already does inside the guess form (submit),
  // so pressing Enter keeps moving the game forward without reaching for
  // the mouse. Listens on window rather than the button itself since focus
  // is often still on the just-hidden guess form when feedback appears.
  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && this.feedback) {
      e.preventDefault()
      this._onNextRound()
    }
  }

  private _onModeSelected = (event: CustomEvent<GameMode>) => {
    this.phase = event.detail === 'singleplayer' ? 'setup' : 'room-setup'
  }

  private _onGameStarted = (event: CustomEvent<GameOptions>) => {
    this.translation = event.detail.translation
    this.verseSource = event.detail.verseSource
    this.roundCount = event.detail.roundCount
    this.roundIndex = 0
    this.rounds = []
    this.phase = 'playing'
    void this._loadNextVerse()
  }

  private async _loadNextVerse() {
    this.error = undefined
    this.feedback = undefined
    try {
      this.verse = await this.verseSource.getRandomVerse(this.translation)
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load a verse.'
    }
  }

  private _onGuessSubmitted = (event: CustomEvent<Guess>) => {
    if (!this.verse) return

    const guess = event.detail
    const points = this._scoreGuess(this.verse, guess)

    this.rounds = [...this.rounds, { verse: this.verse, guess, points }]
    this.feedback = { points, verse: this.verse, guess }
  }

  // Mirrors backend/Domain/Game.fs's Scoring.pointsForVerseGuess: each level
  // only counts if every level before it was also guessed correctly.
  private _scoreGuess(verse: Verse, guess: Guess): number {
    const bookCorrect = guess.book.trim().toLowerCase() === verse.book.trim().toLowerCase()
    if (!bookCorrect) return 0

    const chapterCorrect = guess.chapter !== undefined && guess.chapter === verse.chapter
    if (!chapterCorrect) return BOOK_POINTS

    const verseNumberCorrect = guess.verseNumber !== undefined && guess.verseNumber === verse.verseNumber
    if (!verseNumberCorrect) return BOOK_POINTS + CHAPTER_POINTS

    return BOOK_POINTS + CHAPTER_POINTS + VERSE_NUMBER_POINTS
  }

  // Renders a Guess the same way references are usually written, e.g.
  // "Matthæus", "Matthæus 1" or "Matthæus 1:1" — however far the player got.
  private _formatGuess(guess: Guess): string {
    if (guess.chapter === undefined) return guess.book
    if (guess.verseNumber === undefined) return `${guess.book} ${guess.chapter}`
    return `${guess.book} ${guess.chapter}:${guess.verseNumber}`
  }

  private _onNextRound = () => {
    const isLastRound = this.roundIndex + 1 >= this.roundCount
    if (isLastRound) {
      this.phase = 'gameOver'
      this.verse = undefined
      this.feedback = undefined
    } else {
      this.roundIndex += 1
      void this._loadNextVerse()
    }
  }

  private _onPlayAgain = () => {
    this.phase = 'mode-select'
    this.rounds = []
  }

  render() {
    return html`
      <bg-connection-status .trackSignalR=${this.phase === 'room-setup'}></bg-connection-status>
      <bg-nerd-panel></bg-nerd-panel>
      <main>
        ${this.phase === 'mode-select'
          ? html`<bg-mode-select @mode-selected=${this._onModeSelected}></bg-mode-select>`
          : this.phase === 'setup'
            ? html`<bg-game-setup @game-started=${this._onGameStarted}></bg-game-setup>`
            : this.phase === 'playing'
              ? this._renderPlaying()
              : this.phase === 'gameOver'
                ? html`<bg-game-results .rounds=${this.rounds} @play-again=${this._onPlayAgain}></bg-game-results>`
                : html`<bg-room-setup></bg-room-setup>`}
      </main>
    `
  }

  private _renderPlaying() {
    return html`
      <header>
        <p class="round">Verse ${this.roundIndex + 1} / ${this.roundCount}</p>
        <p class="score">Score: ${this.score}</p>
      </header>

      ${this.error ? html`<p class="error">${this.error}</p>` : null}

      <bg-verse-card .verse=${this.verse} .revealed=${!!this.feedback}></bg-verse-card>

      ${this.feedback
        ? html`
            <div class="feedback ${this.feedback.points > 0 ? 'correct' : 'incorrect'}">
              ${this.feedback.points > 0 ? `+${this.feedback.points} points` : 'No points'} — you guessed
              ${this._formatGuess(this.feedback.guess)}, it was ${this.feedback.verse.reference}.
            </div>
            <button class="next" @click=${this._onNextRound}>
              ${this.roundIndex + 1 >= this.roundCount ? 'See results' : 'Next verse'}
            </button>
          `
        : html`<bg-guess-form
            .disabled=${!this.verse}
            .translation=${this.verse?.translation}
            .verseSource=${this.verseSource}
            @guess-submitted=${this._onGuessSubmitted}
          ></bg-guess-form>`}
    `
  }

  static styles = css`
    :host {
      display: block;
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem 1rem;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 1.5rem;
    }

    .round {
      font-weight: 600;
      margin: 0;
    }

    .score {
      font-weight: 600;
      margin: 0;
    }

    .error {
      color: #d33;
    }

    .feedback {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-weight: 600;
    }

    .feedback.correct {
      background: rgba(34, 197, 94, 0.15);
      color: #16a34a;
    }

    .feedback.incorrect {
      background: rgba(239, 68, 68, 0.15);
      color: #dc2626;
    }

    .next {
      margin-top: 1rem;
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }

  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-app': BgApp
  }
}
