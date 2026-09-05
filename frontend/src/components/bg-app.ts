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
import './report-abuse'

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

  /** Whether the "Report abuse" view is showing — see
   * docs/SCRUM/Feature.ReportAbuse.md. Deliberately a flag alongside
   * `phase` rather than another GamePhase value: reporting can happen from
   * ANY screen, and this way the screen underneath is remembered, so
   * cancelling returns the player exactly where they were rather than to a
   * default. */
  @state()
  private reportingAbuse = false

  /** Mirrors the report view's in-flight state so the toggle can be
   * disabled while a report is being sent, rather than discarding it. */
  @state()
  private reportSending = false

  /** The report button, so focus can be returned to it when the report
   * view closes — see _onReportClosed. */
  private _reportTrigger?: HTMLButtonElement

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

  // In "Chapters" mode, the Chapter field should likewise be a closed
  // dropdown of exactly the selected chapters — not a free-text combobox
  // suggesting every chapter of the (locked) book, which would let a
  // Chapters-mode player guess a chapter they explicitly excluded.
  private get _allowedChaptersForGuessForm(): number[] | undefined {
    const book = this._lockedBookForGuessForm
    return book ? this.restriction?.chaptersByBook[book] : undefined
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
    // Defensive belt-and-braces cleanup — <bg-multiplayer-game>'s own
    // disconnectedCallback already dispatches a final "leaving" event on
    // unmount (see that component), but this covers the case where
    // navigating Home races past that cleanup somehow, so the blink
    // never lingers on document.body after leaving the room screen.
    this._clearCountdownDanger()
  }

  // See docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md — the full-screen
  // blink in the final 7 seconds of a round's countdown. <bg-multiplayer-game>
  // is scoped to its own shadow root (Lit's default), so it can't reach
  // `body`'s background itself — this listener is the escape hatch:
  // toggles a class (and the speed custom property that drives the
  // intensity ramp) on document.body directly, a real unscoped DOM call,
  // matching the existing `game-over` event's composed:true/bubbles:true
  // shape (this component doesn't need to re-dispatch anything itself;
  // those event flags already let it listen on a non-direct-child
  // element like <bg-room-setup>). The actual @keyframes live in the
  // already-global frontend/src/index.css, not any component's own styles.
  private _onCountdownDangerChanged(
    event: CustomEvent<{ active: boolean; animationSeconds?: number; flashColor?: string; flashShape?: string }>,
  ) {
    document.body.classList.toggle('countdown-danger', event.detail.active)
    // On the "leaving" edge (active: false), animationSeconds/flashColor/
    // flashShape are always undefined (see multiplayer-game.ts's
    // _dangerAnimationSeconds/_dangerFlashColor/_dangerFlashShape, all
    // undefined once revealed) — actively remove all three properties
    // here rather than just skipping the set, so they don't linger at
    // whatever value they last held mid-flash. The class alone being
    // gone hides the effect visually either way, but a stale property
    // value is still real leftover state that anything reading these
    // properties directly (e.g. an e2e assertion) would otherwise see
    // indefinitely, until the next round's danger window happens to
    // overwrite it.
    if (event.detail.animationSeconds !== undefined) {
      document.body.style.setProperty('--countdown-danger-speed', `${event.detail.animationSeconds}s`)
    } else {
      document.body.style.removeProperty('--countdown-danger-speed')
    }
    if (event.detail.flashColor !== undefined) {
      document.body.style.setProperty('--countdown-danger-color', event.detail.flashColor)
    } else {
      document.body.style.removeProperty('--countdown-danger-color')
    }
    if (event.detail.flashShape !== undefined) {
      document.body.style.setProperty('--countdown-danger-blink-name', event.detail.flashShape)
    } else {
      document.body.style.removeProperty('--countdown-danger-blink-name')
    }
  }

  private _clearCountdownDanger() {
    document.body.classList.remove('countdown-danger')
    document.body.style.removeProperty('--countdown-danger-speed')
    document.body.style.removeProperty('--countdown-danger-color')
    document.body.style.removeProperty('--countdown-danger-blink-name')
  }

  render() {
    return html`
      <bg-connection-status .trackSignalR=${this.phase === 'room-setup'}></bg-connection-status>
      <div class="layout">
        <main>
          ${this.reportingAbuse
            ? html`<bg-report-abuse
                id="report-abuse-view"
                @report-closed=${this._onReportClosed}
                @report-sending-changed=${this._onReportSendingChanged}
              ></bg-report-abuse>`
            : this._renderCurrentPhase()}
        </main>
        <bg-nerd-panel></bg-nerd-panel>
      </div>
      <button
        type="button"
        class="report-abuse"
        title=${this.reportingAbuse ? 'Close report abuse' : 'Report abuse'}
        aria-label=${this.reportingAbuse ? 'Close report abuse' : 'Report abuse'}
        aria-expanded=${this.reportingAbuse ? 'true' : 'false'}
        aria-controls="report-abuse-view"
        ?disabled=${this.reportSending}
        @click=${this._onToggleReport}
      >
        <span aria-hidden="true">🛡️</span>
      </button>
    `
  }

  private _renderCurrentPhase() {
    return html`
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
                  : html`<bg-room-setup @countdown-danger-changed=${this._onCountdownDangerChanged}></bg-room-setup>`}
    `
  }

  /** One control, two actions — see
   * docs/SCRUM/TODO/Feature.ToggleAbuseReport.md. Closing through the icon
   * is deliberately the same path as the view's own Cancel, so unsent text
   * is discarded identically and no report is submitted either way. */
  private _onToggleReport(event: Event) {
    if (this.reportingAbuse) {
      this._onReportClosed()
      return
    }

    this._reportTrigger = event.currentTarget as HTMLButtonElement
    this.reportingAbuse = true
    // Focus the report view's heading region so keyboard and
    // screen-reader users land on the new view rather than staying on a
    // button that is now behind it.
    this.updateComplete.then(() => {
      this.shadowRoot?.querySelector('bg-report-abuse')?.shadowRoot?.querySelector<HTMLElement>('h1')?.focus()
    })
  }

  private _onReportSendingChanged(event: CustomEvent<boolean>) {
    this.reportSending = event.detail
  }

  private _onReportClosed() {
    this.reportingAbuse = false
    this.reportSending = false
    const trigger = this._reportTrigger
    this._reportTrigger = undefined
    this.updateComplete.then(() => {
      if (trigger?.isConnected) trigger.focus()
    })
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
            .allowedChapters=${this._allowedChaptersForGuessForm}
            @guess-submitted=${this._onGuessSubmitted}
          ></bg-guess-form>`}
    `
  }

  static styles = css`
    :host {
      display: block;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    /* Sticky "Report abuse" control — see
       docs/SCRUM/Feature.ReportAbuse.md. Bottom-LEFT deliberately: the
       nerd panel and the game's own controls live to the right, so this
       corner is the one place it won't cover the countdown, chat or form
       fields on any screen. env(safe-area-inset-*) keeps it clear of the
       home indicator and rounded corners on mobile. A real <button> with
       an aria-label, not a bare icon, so it has an accessible name. */
    .report-abuse {
      position: fixed;
      left: calc(0.75rem + env(safe-area-inset-left, 0px));
      bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
      z-index: 100;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 50%;
      border: 1px solid rgba(128, 128, 128, 0.5);
      background: rgba(20, 20, 24, 0.85);
      color: inherit;
      font-size: 1.2rem;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      /* Dimmed until hovered/focused so it stays unobtrusive during play,
         without ever becoming invisible or unreachable. */
      opacity: 0.65;
      transition: opacity 0.15s ease;
    }

    .report-abuse:hover,
    .report-abuse:focus-visible {
      opacity: 1;
    }

    .report-abuse:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
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
