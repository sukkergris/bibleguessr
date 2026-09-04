import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { scoreGuess } from '../scoring'
import type { Guess, RoundResult, Verse, VerseRestriction, VerseSource } from '../types'
import './verse-card'
import './guess-form'
import './game-setup'
import type { GameOptions, SetupScope } from './game-setup'
import './game-results'
import './mode-select'
import type { GameMode } from './mode-select'
import './bg-room-setup'
import './connection-status'
import './nerd-panel'

type Feedback = { points: number; verse: Verse; guess: Guess } | undefined

type GamePhase = 'mode-select' | 'setup' | 'playing' | 'gameOver' | 'room-setup'

const SETUP_SCOPE_BY_MODE: Record<Exclude<GameMode, 'multiplayer'>, SetupScope> = {
  'singleplayer-all': 'all',
  'singleplayer-books': 'books',
  'singleplayer-chapters': 'chapters',
}

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

  // Which books/chapters this game's verses are drawn from — see
  // docs/SCRUM/Feature.BibleSelector.md. Undefined means "default ALL",
  // chosen per game by bg-game-setup's book/chapter selector.
  @state()
  private restriction?: VerseRestriction

  // Which of the three singleplayer game types (see mode-select.ts) is
  // currently being set up — drives which selector bg-game-setup shows.
  @state()
  private setupScope: SetupScope = 'all'

  // Each game type's own book/chapter selection, kept alive across visits
  // to mode-select and back — e.g. picking a handful of books in "Books"
  // mode, backing out to Home, then coming back into "Books" mode restores
  // that same selection rather than starting empty again. Deliberately
  // three separate slots (not one shared `restriction`) so switching game
  // types never clobbers another type's selection.
  @state()
  private booksRestriction?: VerseRestriction

  @state()
  private chaptersRestriction?: VerseRestriction

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
    if (event.detail === 'multiplayer') {
      this.phase = 'room-setup'
      return
    }

    this.setupScope = SETUP_SCOPE_BY_MODE[event.detail]
    this.phase = 'setup'
  }

  private _onGameStarted = (event: CustomEvent<GameOptions>) => {
    this.translation = event.detail.translation
    this.verseSource = event.detail.verseSource
    this.roundCount = event.detail.roundCount
    this.restriction = event.detail.restriction
    this.roundIndex = 0
    this.rounds = []
    this.phase = 'playing'
    void this._loadNextVerse()
  }

  // The persisted selection to hand bg-game-setup for the game type it's
  // currently configuring, so returning to a scope restores what was
  // picked last time — see booksRestriction/chaptersRestriction.
  private get _initialRestrictionForScope(): VerseRestriction | undefined {
    if (this.setupScope === 'books') return this.booksRestriction
    if (this.setupScope === 'chapters') return this.chaptersRestriction
    return undefined
  }

  // Tracks the in-progress selection live, as the player checks/unchecks
  // books or chapters — not just once they hit "Start game" — so leaving
  // this screen (Home, or picking a different game type) without starting
  // a game still keeps whatever they'd selected so far.
  private _onScopeRestrictionChanged = (event: CustomEvent<VerseRestriction | undefined>) => {
    if (this.setupScope === 'books') this.booksRestriction = event.detail
    if (this.setupScope === 'chapters') this.chaptersRestriction = event.detail
  }

  // In "Books" mode specifically, the guess form's Book field should be a
  // closed dropdown of exactly the selected books — no free typing, and no
  // suggesting books outside the selection (today's guess-form otherwise
  // autocompletes from every book in the translation, which would let a
  // Books-mode player type/guess a book they explicitly excluded).
  // "Chapters" mode also restricts to one book, but via _lockedBookForGuessForm
  // instead — this only applies to "Books" mode's multi-book selection.
  private get _allowedBooksForGuessForm(): string[] | undefined {
    return this.setupScope === 'books' ? this.restriction?.books : undefined
  }

  // In "Chapters" mode, the player already committed to one book at setup
  // — there's nothing left to choose, so the guess form shows it as fixed,
  // read-only text instead of any kind of editable field.
  private get _lockedBookForGuessForm(): string | undefined {
    return this.setupScope === 'chapters' ? this.restriction?.books[0] : undefined
  }

  private async _loadNextVerse() {
    this.error = undefined
    this.feedback = undefined
    try {
      this.verse = await this.verseSource.getRandomVerse(this.translation, this.restriction)
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load a verse.'
    }
  }

  private _onGuessSubmitted = (event: CustomEvent<Guess>) => {
    if (!this.verse) return

    const guess = event.detail
    const points = scoreGuess(this.verse, guess)

    this.rounds = [...this.rounds, { verse: this.verse, guess, points }]
    this.feedback = { points, verse: this.verse, guess }
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

  // Bails out to the home (mode-select) screen from anywhere — resets the
  // same in-progress-game state _onPlayAgain does, so leaving mid-game
  // doesn't leave stale rounds/verse/feedback lying around for next time.
  private _onGoHome = () => {
    this.phase = 'mode-select'
    this.rounds = []
    this.roundIndex = 0
    this.verse = undefined
    this.feedback = undefined
    this.error = undefined
  }

  render() {
    return html`
      <bg-connection-status .trackSignalR=${this.phase === 'room-setup'}></bg-connection-status>
      <div class="layout">
        <main>
          ${this.phase !== 'mode-select'
            ? html`<button type="button" class="home" @click=${this._onGoHome}>← Home</button>`
            : null}
          ${this.phase === 'mode-select'
            ? html`<bg-mode-select @mode-selected=${this._onModeSelected}></bg-mode-select>`
            : this.phase === 'setup'
              ? html`<bg-game-setup
                  .scope=${this.setupScope}
                  .initialRestriction=${this._initialRestrictionForScope}
                  @game-started=${this._onGameStarted}
                  @scope-restriction-changed=${this._onScopeRestrictionChanged}
                ></bg-game-setup>`
              : this.phase === 'playing'
                ? this._renderPlaying()
                : this.phase === 'gameOver'
                  ? html`<bg-game-results .rounds=${this.rounds} @play-again=${this._onPlayAgain}></bg-game-results>`
                  : html`<bg-room-setup></bg-room-setup>`}
        </main>
        <bg-nerd-panel></bg-nerd-panel>
      </div>
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
            .allowedBooks=${this._allowedBooksForGuessForm}
            .lockedBook=${this._lockedBookForGuessForm}
            @guess-submitted=${this._onGuessSubmitted}
          ></bg-guess-form>`}
    `
  }

  static styles = css`
    :host {
      display: block;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    /* The nerd panel takes real layout space (a flex sibling) rather than
       floating over the content, so opening it visibly narrows the main
       column instead of covering part of it. */
    .layout {
      display: flex;
      align-items: flex-start;
      min-height: 100vh;
    }

    main {
      flex: 1;
      min-width: 0;
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    .home {
      display: block;
      margin: 0 0 1rem;
      padding: 0.4rem 0.8rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      background: transparent;
      color: #6b6375;
      font-size: 0.85rem;
      cursor: pointer;
    }

    @media (prefers-color-scheme: dark) {
      .home {
        color: #9ca3af;
      }
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
