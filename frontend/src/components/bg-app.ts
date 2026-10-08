import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { freshChoice, guessConstraintOf, maxPointsOf, nameOf, scoreGuessOf, sharedColumnsOf, verseRestrictionOf, type GameTypeChoice, type GameTypeId } from '../game-types/registry'
import { ANY_BOOK, type GuessConstraint } from '../shared-kernel/guess-constraint'
import type { Guess, RoundResult, Verse, VerseSource } from '../types'
import '../shared-ui/verse-card'
import '../shared-ui/guess-form'
import './game-setup'
import type { GameOptions, SavedGameTypeChoice } from './game-setup'
import './game-results'
import './mode-select'
import type { GameMode } from './mode-select'
import './bg-room-setup'
import './connection-status'
import './nerd-panel'
import './report-abuse'
import './bug-report'
import '../social/social-home'
import type { SocialView } from '../social/social-home'
import '../congregation/spectator-board'
import './about-page'
import { NavigationController } from '../routing/navigation-controller'
import { HOME, pathOf, urlOf, type Route } from '../routing/routes'
import type { RoomEnteredDetail } from './bg-room-setup'

type Feedback = { points: number; verse: Verse; guess: Guess } | undefined

/** Where a singleplayer game is, within its game type's address (see
 * routing/routes.ts) — a game in progress has no address of its own, so a
 * reload goes back to its setup screen. */
type SingleplayerStage = 'setup' | 'playing' | 'gameOver'

@customElement('bg-app')
export class BgApp extends LitElement {
  /** Which screen is showing, kept in step with the address bar — see
   * docs/web/url-routing. */
  private navigation = new NavigationController(this)

  /** The path last rendered, to notice when the screen changes — by a
   * button, a link, or Back/Forward alike (see willUpdate). */
  private _shownPath = pathOf(this.navigation.route)

  @state()
  private singleplayerStage: SingleplayerStage = 'setup'

  /** Whether the "Report abuse" view is showing — see
   * docs/SCRUM/Feature.ReportAbuse.md. Deliberately a flag alongside the
   * route rather than a route of its own: reporting can happen from ANY
   * screen, and this way the screen underneath is remembered, so
   * canceling returns the player exactly where they were rather than to a
   * default. */
  @state()
  private reportingAbuse = false

  /** Mirrors the report view's in-flight state so the toggle can be
   * disabled while a report is being sent, rather than discarding it. */
  @state()
  private reportSending = false

  /** Whether the general bug-report panel is showing — see
   * docs/SCRUM/DONE/Feature.BugReport.md. A separate flag from
   * reportingAbuse for the same reason: reporting can happen from any
   * screen, and the screen underneath must be remembered. */
  @state()
  private reportingBug = false

  private _bugTrigger?: HTMLButtonElement

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

  // The game type and selection of the game in progress — see
  // game-types/registry.ts. This shell never branches on which game type
  // it is; it only asks the registry.
  @state()
  private choice: GameTypeChoice = freshChoice('the-bible')

  // What the guess form offers for the game in progress — derived from
  // `choice` once at game start rather than on every render.
  @state()
  private guessConstraint: GuessConstraint = ANY_BOOK

  // Each game type's own selection, kept alive across visits to
  // mode-select and back — e.g. picking a handful of books in "Books",
  // backing out to Home, then coming back into "Books" restores that same
  // selection rather than starting empty again. One slot per game type so
  // switching types never clobbers another type's selection. Each is kept
  // with the Bible it was made against, and only restored for that Bible.
  @state()
  private savedChoices: Partial<Record<GameTypeId, SavedGameTypeChoice>> = {}

  @state()
  private roundCount = 0

  // When the game in progress was finished — for the shared result.
  @state()
  private finishedAt?: string

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

  // Whatever moved the app to a different screen — a button here, a link,
  // or the browser's Back/Forward — any singleplayer game in progress is
  // left behind, exactly as "← Home" always did.
  protected willUpdate() {
    const path = pathOf(this.navigation.route)
    if (path === this._shownPath) return
    this._shownPath = path
    this._resetGame()
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
    const mode = event.detail
    this.navigation.navigate(mode.kind === 'singleplayer' ? { kind: 'singleplayer', gameType: mode.gameType } : { kind: mode.kind })
  }

  private _onGameStarted = (event: CustomEvent<GameOptions>) => {
    this.translation = event.detail.translation
    this.verseSource = event.detail.verseSource
    this.roundCount = event.detail.roundCount
    this.choice = event.detail.choice
    this.guessConstraint = guessConstraintOf(event.detail.choice)
    this.roundIndex = 0
    this.rounds = []
    this.singleplayerStage = 'playing'
    void this._loadNextVerse()
  }

  // Tracks the in-progress choice live, as the player checks/unchecks
  // books or chapters — not just once they hit "Start game" — so leaving
  // this screen (Home, or picking a different game type) without starting
  // a game still keeps whatever they'd selected so far.
  private _onGameTypeChoiceChanged = (event: CustomEvent<SavedGameTypeChoice>) => {
    this.savedChoices = { ...this.savedChoices, [event.detail.choice.gameType]: event.detail }
  }

  private async _loadNextVerse() {
    this.error = undefined
    this.feedback = undefined
    // Cleared rather than left showing until the next one arrives: the
    // previous verse must not be on screen — or guessable, scored against
    // the wrong verse — while the next one loads. The card keeps its size
    // meanwhile (see verse-card.ts), so this doesn't make the screen jump.
    this.verse = undefined
    try {
      this.verse = await this.verseSource.getRandomVerse(this.translation, verseRestrictionOf(this.choice))
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load a verse.'
    }
  }

  private _onGuessSubmitted = (event: CustomEvent<Guess>) => {
    if (!this.verse) return

    const guess = event.detail
    const points = scoreGuessOf(this.choice, this.verse, guess)

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
      this.singleplayerStage = 'gameOver'
      this.finishedAt = new Date().toISOString()
      this.verse = undefined
      this.feedback = undefined
    } else {
      this.roundIndex += 1
      void this._loadNextVerse()
    }
  }

  private _onPlayAgain = () => {
    this.navigation.navigate(HOME)
  }

  // Bails out to the home (mode-select) screen from anywhere. The game
  // itself is reset by the screen change — see willUpdate.
  private _onGoHome = () => {
    this.navigation.navigate(HOME)
  }

  // Leaving a screen leaves any game on it: so stale rounds, verse and
  // feedback aren't lying around for next time.
  private _resetGame() {
    this.singleplayerStage = 'setup'
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
      <bg-connection-status
        .trackSignalR=${this.navigation.route.kind === 'multiplayer' || this.navigation.route.kind === 'watch'}
      ></bg-connection-status>
      <div class="layout">
        <main>
          ${this.reportingAbuse
            ? html`<bg-report-abuse
                id="report-abuse-view"
                @report-closed=${this._onReportClosed}
                @report-sending-changed=${this._onReportSendingChanged}
              ></bg-report-abuse>`
            : this.reportingBug
              ? html`<bg-bug-report
                  id="bug-report-view"
                  @report-closed=${this._onBugClosed}
                  @report-sending-changed=${this._onReportSendingChanged}
                ></bg-bug-report>`
              : this._renderScreen(this.navigation.route)}
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
      <button
        type="button"
        class="report-bug"
        title=${this.reportingBug ? 'Close bug report' : 'Report a bug'}
        aria-label=${this.reportingBug ? 'Close bug report' : 'Report a bug'}
        aria-expanded=${this.reportingBug ? 'true' : 'false'}
        aria-controls="bug-report-view"
        ?disabled=${this.reportSending}
        @click=${this._onToggleBug}
      >
        <span aria-hidden="true">🐛</span>
      </button>
    `
  }

  /** Same toggle contract as the abuse report's — see
   * _onToggleReport. Closing through the icon is the panel's Cancel path,
   * so nothing is submitted either way. */
  private _onToggleBug(event: Event) {
    if (this.reportingBug) {
      this._onBugClosed()
      return
    }

    this._bugTrigger = event.currentTarget as HTMLButtonElement
    this.reportingBug = true
    this.updateComplete.then(() => {
      this.shadowRoot?.querySelector('bg-bug-report')?.shadowRoot?.querySelector<HTMLElement>('h1')?.focus()
    })
  }

  private _onBugClosed() {
    this.reportingBug = false
    this.reportSending = false
    const trigger = this._bugTrigger
    this._bugTrigger = undefined
    this.updateComplete.then(() => {
      if (trigger?.isConnected) trigger.focus()
    })
  }

  private _renderScreen(route: Route) {
    switch (route.kind) {
      case 'home':
        return html`<bg-mode-select @mode-selected=${this._onModeSelected}></bg-mode-select>`
      case 'watch':
        // An ordinary link: the navigation controller turns the click into
        // an in-page move home.
        return html`
          <a class="home" href=${pathOf(HOME)}>← Open BibleGuessr</a>
          <bg-spectator-board .roomCode=${route.roomCode}></bg-spectator-board>
        `
      default:
        return html`
          <button type="button" class="home" @click=${this._onGoHome}>← Home</button>
          ${this._renderArea(route)}
        `
    }
  }

  private _renderArea(route: Exclude<Route, { kind: 'home' } | { kind: 'watch' }>) {
    switch (route.kind) {
      case 'singleplayer':
        return this._renderSingleplayer(route.gameType)
      case 'multiplayer':
        return html`<bg-room-setup
          .routeRoomCode=${route.roomCode}
          @room-entered=${this._onRoomEntered}
          @room-left=${this._onRoomLeft}
          @countdown-danger-changed=${this._onCountdownDangerChanged}
        ></bg-room-setup>`
      case 'social':
      case 'daily-quiz':
        return html`<bg-social-home
          .view=${route.kind === 'daily-quiz' ? 'daily-quiz' : 'home'}
          .dailyQuizUrl=${urlOf({ kind: 'daily-quiz' }, window.location.origin)}
          .serverSource=${api}
          .submitBibleFileReport=${api.submitBibleFileUploadReport}
          @social-view-requested=${this._onSocialViewRequested}
        ></bg-social-home>`
      case 'about':
        return html`<bg-about-page></bg-about-page>`
    }
  }

  private _renderSingleplayer(gameType: GameTypeId) {
    switch (this.singleplayerStage) {
      case 'setup':
        return html`<bg-game-setup
          .gameType=${gameType}
          .savedChoice=${this.savedChoices[gameType]}
          @game-started=${this._onGameStarted}
          @game-type-choice-changed=${this._onGameTypeChoiceChanged}
        ></bg-game-setup>`
      case 'playing':
        return this._renderPlaying()
      case 'gameOver':
        return html`<bg-game-results
          .rounds=${this.rounds}
          .gameTypeName=${nameOf(this.choice.gameType)}
          .columns=${sharedColumnsOf(this.choice)}
          .maxPointsPerVerse=${maxPointsOf(this.choice)}
          .finishedAt=${this.finishedAt}
          .shareUrl=${urlOf({ kind: 'singleplayer', gameType: this.choice.gameType }, window.location.origin)}
          @play-again=${this._onPlayAgain}
        ></bg-game-results>`
    }
  }

  // Entering a room gives it an address of its own (/multiplayer/<code>)
  // — something to share, and what Back leaves. World chat has no code,
  // so it has the plain /multiplayer address.
  private _onRoomEntered = (event: CustomEvent<RoomEnteredDetail>) => {
    this.navigation.navigate({ kind: 'multiplayer', roomCode: event.detail.roomCode })
  }

  private _onRoomLeft = () => {
    this.navigation.navigate({ kind: 'multiplayer' })
  }

  private _onSocialViewRequested = (event: CustomEvent<SocialView>) => {
    this.navigation.navigate(event.detail === 'daily-quiz' ? { kind: 'daily-quiz' } : { kind: 'social' })
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

  /** What to announce about the game's current state. Deliberately one
   * derived string rather than announcements scattered through the
   * markup, so each change is announced exactly once and a round change
   * cannot be announced twice by two regions. */
  private _gameAnnouncement(): string {
    const round = `Round ${this.roundIndex + 1} of ${this.roundCount}.`
    if (!this.feedback) return round

    const scored =
      this.feedback.points > 0 ? `Correct, ${this.feedback.points} points.` : 'No points.'
    return `${round} ${scored} It was ${this.feedback.verse.reference}. Score ${this.score}.`
  }

  private _renderPlaying() {
    return html`
      <header>
        <p class="round">Verse ${this.roundIndex + 1} / ${this.roundCount}</p>
        <p class="score">Score: ${this.score}</p>
      </header>

      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : null}

      <!-- One live region for game progress. A screen-reader user
           otherwise learns nothing about which round they are on or how
           their guess scored, since both are conveyed visually only.
           role="status" (polite) rather than alert: progress should not
           interrupt what the player is doing. The error above is an
           alert precisely because it does need to. -->

      <p class="visually-hidden" role="status">${this._gameAnnouncement()}</p>

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
            .translation=${this.translation}
            .verseSource=${this.verseSource}
            .constraint=${this.guessConstraint}
            @guess-submitted=${this._onGuessSubmitted}
          ></bg-guess-form>`}
    `
  }

  static styles = css`
    /* Available to screen readers, invisible on screen — see
       chat-panel.ts for the same pattern. */
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    :host {
      display: block;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    /* Sticky "Report abuse" control — see
       docs/SCRUM/Feature.ReportAbuse.md. Bottom-LEFT deliberately: the
       nerd panel and the game's own controls live to the right, so this
       corner is the one place it won't cover the countdown, chat or form
       fields on any screen — the guess form's bottom-pinned bar keeps
       --corner-controls-inline-clearance free for it (see index.css). env(safe-area-inset-*) keeps it clear of the
       home indicator and rounded corners on mobile. A real <button> with
       an aria-label, not a bare icon, so it has an accessible name. */
    .report-abuse {
      position: fixed;
      left: calc(var(--corner-button-inset) + env(safe-area-inset-left, 0px));
      bottom: calc(var(--corner-button-inset) + env(safe-area-inset-bottom, 0px));
      z-index: 100;
      width: var(--corner-button-size);
      height: var(--corner-button-size);
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

    /* Mirrors the report button but on the RIGHT edge, per
       docs/SCRUM/DONE/Feature.BugReport.md — clear of the left-hand
       report control and of the nerd panel's own toggle. */
    .report-bug {
      position: fixed;
      right: calc(var(--corner-button-inset) + env(safe-area-inset-right, 0px));
      bottom: calc(var(--corner-button-inset) + env(safe-area-inset-bottom, 0px));
      z-index: 100;
      width: var(--corner-button-size);
      height: var(--corner-button-size);
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
      opacity: 0.65;
      transition: opacity 0.15s ease;
    }

    .report-bug:hover,
    .report-bug:focus-visible {
      opacity: 1;
    }

    .report-bug:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    .report-abuse:hover,
    .report-abuse:focus-visible {
      opacity: 1;
    }

    .report-abuse:focus-visible {
      outline: 2px solid var(--focus);
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
      color: var(--text-muted);
      font-size: 0.85rem;
      cursor: pointer;
    }

    /* The spectator board's way back is a link, not a button. */
    a.home {
      width: fit-content;
      text-decoration: none;
    }

    a.home:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
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
      color: var(--error);
    }

    .feedback {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-weight: 600;
    }

    .feedback.correct {
      background: rgba(34, 197, 94, 0.15);
      color: var(--success);
    }

    .feedback.incorrect {
      background: rgba(239, 68, 68, 0.15);
      color: var(--error);
    }

    .next {
      margin-top: 1rem;
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
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
