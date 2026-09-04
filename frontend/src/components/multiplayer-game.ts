import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  allowedBooksForGuessForm,
  allowedChaptersForGuessForm,
  bookNumberOfGuess,
  lockedBookForGuessForm,
} from '../game-type'
import {
  forfeitGame,
  onGameOver,
  onPlayerDisconnected,
  onPlayerLeft,
  onRoundScored,
  onRoundStarted,
  submitGuess,
} from '../signalr-client'
import { computeRemainingSeconds, deadlineOf } from '../timer'
import type { GameOverReason, GameSession, GameType, Guess, Verse, VerseReference, VerseSource } from '../types'
import type { MultiplayerGameOverDetail, MultiplayerRoundSummary } from './multiplayer-results'
import './verse-card'
import './guess-form'

/** How often the local countdown re-renders — purely cosmetic, no network
 * traffic involved (see timer.ts's computeRemainingSeconds). 250ms rather
 * than 1000ms so the displayed number doesn't visibly "stick" for up to a
 * second before decrementing. */
const COUNTDOWN_TICK_MS = 250

/**
 * A live synced multiplayer round, from the moment a challenge is accepted
 * through the final round's result — owns everything moment-to-moment
 * (current round's verse, my own guess-locked-in state, the countdown,
 * the opponent's connection status, and the running scoreboard). Mounted
 * by bg-room-setup.ts in place of the game-type-select/chat-panel/
 * play-requests block while a game is active — see docs/SCRUM/Feature.RequestToStartMPGame.md
 * and docs/SCRUM/Feature.Time.md.
 *
 * <bg-verse-card>/<bg-guess-form> are reused verbatim — this component
 * only layers timer/opponent-status/scoreboard chrome around them, and
 * swaps the guess form out entirely (not just `disabled`) for a "locked
 * in" message once I've submitted.
 *
 * The server is authoritative for verse selection, scoring, and round
 * advancement — this component never computes points itself, only
 * displays what RoundStarted/RoundScored/GameOver report (see
 * types.ts's GameSession doc comment on why those are full snapshots, not
 * deltas).
 *
 * Each round's server state is a bare VerseReference (book/chapter/
 * verseNumber only — see types.ts's RoundState doc comment: the server
 * never sends verse TEXT, since two players in the same game may each be
 * reading a different translation/uploaded file, chosen before entering
 * the room — see bg-room-setup.ts's translation picker). This component
 * resolves that reference to displayable text itself, via `verseSource`
 * (this player's OWN chosen VerseSource), on every RoundStarted/RoundScored
 * — see _resolveVerse. If this player's source doesn't have the
 * referenced verse (a translation/file mismatch — rare, per
 * docs/SCRUM/Feature.RequestToStartMPGame.md, and deliberately not fixed
 * up), a small fallback message is shown for that round instead of text.
 *
 * Fires two events up to bg-room-setup.ts:
 * - `game-over: CustomEvent<MultiplayerGameOverDetail>` once the server
 *   says the game has ended (completed normally, or either player
 *   forfeited) — carries enough to render <bg-multiplayer-results>.
 * - `game-ended` (no detail) only for the purely-local "I clicked leave
 *   and confirmed" case, before any server round-trip completes — just
 *   tears this view down back to the room, no results screen.
 */
@customElement('bg-multiplayer-game')
export class MultiplayerGame extends LitElement {
  @property({ attribute: false })
  myPlayerId = ''

  @property({ attribute: false })
  myPlayerName = ''

  @property({ attribute: false })
  opponentId = ''

  @property({ attribute: false })
  opponentName = ''

  @property({ attribute: false })
  translation?: string

  /** This player's own chosen verse source — see bg-room-setup.ts's
   * pre-name translation/file picker. Used both by <bg-guess-form>'s
   * autocomplete AND to resolve each round's VerseReference to
   * displayable text (see _resolveVerse). */
  @property({ attribute: false })
  verseSource?: VerseSource

  @state()
  private session?: GameSession

  /** The current round's verse, resolved from its VerseReference against
   * `verseSource` — undefined while resolving or before a round has
   * started. See _resolveVerse. */
  @state()
  private resolvedVerse?: Verse

  /** Set when `verseSource` couldn't resolve the current round's
   * VerseReference (a translation/file mismatch — see the class doc
   * comment) — shown in place of the verse card's text for this round. */
  @state()
  private verseResolutionError?: string

  @state()
  private myGuess?: Guess

  /** The guess form's book restriction, resolved from `session.gameType`
   * (which carries book NUMBERS — see types.ts's GameType doc comment)
   * against MY OWN verseSource — see _resolveGuessFormRestriction. Kept
   * as one object (rather than three separate @state fields) so a single
   * resolution pass updates all three together, avoiding a render with
   * only some of them updated. */
  @state()
  private guessFormRestriction: {
    allowedBooks?: string[]
    lockedBook?: string
    allowedChapters?: number[]
  } = {}

  @state()
  private opponentConnectionState: 'connected' | 'disconnected' = 'connected'

  /** This game's round-by-round history, accumulated locally as
   * RoundScored events arrive — see multiplayer-results.ts's doc comment
   * on why the server itself doesn't send this. */
  @state()
  private rounds: MultiplayerRoundSummary[] = []

  // Ticked locally to redraw the countdown — see COUNTDOWN_TICK_MS. Not
  // itself meaningful state beyond "cause a re-render"; computeRemainingSeconds
  // reads it fresh each render.
  @state()
  private _now = Date.now()

  private _unsubscribeRoundStarted?: () => void
  private _unsubscribeRoundScored?: () => void
  private _unsubscribeGameOver?: () => void
  private _unsubscribePlayerDisconnected?: () => void
  private _unsubscribePlayerLeft?: () => void
  private _tickHandle?: ReturnType<typeof setInterval>

  connectedCallback() {
    super.connectedCallback()

    // Every game event is broadcast to the WHOLE room, not routed to just
    // the two players involved (see GameHub.fs's targeting doc comment —
    // same tradeoff as PlayRequestReceived) — a room can have more than
    // one game running concurrently (e.g. World chat), so every handler
    // below must filter to sessions/scores that actually name MY
    // opponent, exactly the way bg-room-setup.ts already filters
    // PlayRequestReceived/Accepted by player id.
    this._unsubscribeRoundStarted = onRoundStarted((session) => {
      if (!this._isMySession(session)) return
      const isFirstRound = !this.session
      this.session = session
      this.myGuess = undefined
      this._resolveCurrentVerse()
      // gameType is fixed for the whole game (see types.ts's GameSession),
      // so this only needs resolving once, on the first round.
      if (isFirstRound) this._resolveGuessFormRestriction(session.gameType)
    })
    this._unsubscribeRoundScored = onRoundScored((session) => {
      if (!this._isMySession(session)) return
      this.session = session
      this._recordRoundResult(session)
      this._resolveCurrentVerse()
    })
    this._unsubscribeGameOver = onGameOver((scores, playerA, playerB, reason) => {
      if (!this._isMyGame(playerA, playerB)) return
      this._onGameOver(scores, playerA, playerB, reason)
    })
    this._unsubscribePlayerDisconnected = onPlayerDisconnected((playerId) => {
      if (playerId === this.opponentId) this.opponentConnectionState = 'disconnected'
    })
    this._unsubscribePlayerLeft = onPlayerLeft((playerId) => {
      if (playerId !== this.opponentId) return
      this.dispatchEvent(new CustomEvent('game-ended', { bubbles: true, composed: true }))
    })

    this._tickHandle = setInterval(() => {
      this._now = Date.now()
    }, COUNTDOWN_TICK_MS)
  }

  disconnectedCallback() {
    this._unsubscribeRoundStarted?.()
    this._unsubscribeRoundScored?.()
    this._unsubscribeGameOver?.()
    this._unsubscribePlayerDisconnected?.()
    this._unsubscribePlayerLeft?.()
    if (this._tickHandle !== undefined) clearInterval(this._tickHandle)
    super.disconnectedCallback()
  }

  // Whether `session`/`(playerA, playerB)` belongs to MY game with
  // opponentId — see the room-wide-broadcast filtering note in
  // connectedCallback above. Order-independent since either player could
  // be PlayerA or PlayerB depending on who was the challenger.
  private _isMySession(session: GameSession): boolean {
    return this._isMyGame(session.playerA, session.playerB)
  }

  private _isMyGame(playerA: string, playerB: string): boolean {
    const pair = new Set([playerA, playerB])
    return pair.has(this.myPlayerId) && pair.has(this.opponentId)
  }

  // Appends this round's outcome (my points / opponent's points) to the
  // local history, mirroring bg-app.ts's `rounds` accumulation pattern —
  // the server itself has no round-history endpoint (see
  // backend/Domain/Game.fs's GameSession.GuessesThisRound doc comment),
  // so this is the only place that history is ever assembled.
  private _recordRoundResult(session: GameSession) {
    if (session.round.Case !== 'Scored') return
    const [verse, results] = session.round.Fields

    const pointsFor = (playerId: string) => results.find((r) => r.playerId === playerId)?.pointsAwarded ?? 0

    this.rounds = [
      ...this.rounds,
      { verse, myPoints: pointsFor(this.myPlayerId), opponentPoints: pointsFor(this.opponentId) },
    ]
  }

  private _onGameOver(
    scores: Record<string, number>,
    playerA: string,
    playerB: string,
    reason: GameOverReason,
  ) {
    void playerA
    void playerB
    const myScore = scores[this.myPlayerId] ?? 0
    const opponentScore = scores[this.opponentId] ?? 0

    const detail: MultiplayerGameOverDetail = {
      myPlayerName: this.myPlayerName,
      opponentName: this.opponentName,
      myScore,
      opponentScore,
      reason:
        reason.Case === 'Completed'
          ? { kind: 'completed' }
          : {
              kind: 'forfeited',
              winnerIsMe: reason.Fields[0] === undefined ? undefined : reason.Fields[0] === this.myPlayerId,
            },
      rounds: this.rounds,
    }

    this.dispatchEvent(new CustomEvent<MultiplayerGameOverDetail>('game-over', { detail, bubbles: true, composed: true }))
  }

  // The current round's bare reference (book/chapter/verseNumber only —
  // see the class doc comment) as sent by the server. `resolvedVerse` is
  // what actually has text to display, resolved from this against
  // `verseSource` — see _resolveCurrentVerse.
  private get _currentReference(): VerseReference | undefined {
    if (!this.session) return undefined
    return this.session.round.Case === 'InProgress' || this.session.round.Case === 'Scored'
      ? this.session.round.Fields[0]
      : undefined
  }

  // Resolves _currentReference to a displayable Verse against THIS
  // player's own verseSource — never the server, and never anything sent
  // by the opponent (see the class doc comment). Called after every
  // RoundStarted/RoundScored, since each carries a new/updated reference.
  private _resolveCurrentVerse() {
    const reference = this._currentReference
    this.resolvedVerse = undefined
    this.verseResolutionError = undefined

    if (!reference || !this.verseSource) return

    // Guard against a stale response landing after a later round has
    // already started (e.g. a slow lookup for round 1 resolving after
    // round 2's reference already replaced it) — only apply the result if
    // the reference it was resolved for is still the current one.
    const requestedFor = reference

    this.verseSource
      .lookupVerse(reference, this.translation)
      .then((verse) => {
        if (this._currentReference !== requestedFor) return
        this.resolvedVerse = verse
      })
      .catch((err) => {
        if (this._currentReference !== requestedFor) return
        console.error('[bg-multiplayer-game] failed to resolve verse reference', err)
        this.verseResolutionError =
          err instanceof Error ? err.message : "This verse isn't available in your chosen translation/file."
      })
  }

  // Resolves the guess form's book/chapter restriction from `gameType`
  // (which carries book NUMBERS — see types.ts's GameType doc comment)
  // against MY OWN verseSource, so the guess form shows MY OWN spelling
  // for whatever books/chapters the challenger restricted the game to —
  // see game-type.ts's allowedBooksForGuessForm/lockedBookForGuessForm.
  private _resolveGuessFormRestriction(gameType: GameType) {
    if (!this.verseSource) return
    const verseSource = this.verseSource

    Promise.all([
      allowedBooksForGuessForm(gameType, verseSource, this.translation),
      lockedBookForGuessForm(gameType, verseSource, this.translation),
    ]).then(([allowedBooks, lockedBook]) => {
      this.guessFormRestriction = { allowedBooks, lockedBook, allowedChapters: allowedChaptersForGuessForm(gameType) }
    })
  }

  private get _revealed() {
    return this.session?.round.Case === 'Scored'
  }

  private get _deadline(): string | undefined {
    if (!this.session) return undefined
    return deadlineOf(this.session.roundStartedAt, this.session.roundTimeLimit)
  }

  render() {
    if (!this.session) {
      return html`<p class="loading">Waiting for the first verse…</p>`
    }

    const myScore = this.session.scores[this.myPlayerId] ?? 0
    const opponentScore = this.session.scores[this.opponentId] ?? 0

    return html`
      <header class="mp-header">
        <div class="scoreboard">
          <span class="me">${this.myPlayerName}: ${myScore}</span>
          <span class="round-label">Round ${this.session.roundIndex + 1} / ${this.session.roundCount}</span>
          <span class="opponent ${this.opponentConnectionState}">${this.opponentName}: ${opponentScore}</span>
        </div>
        ${this._renderCountdown()}
      </header>

      ${this.opponentConnectionState === 'disconnected'
        ? html`<p class="opponent-status">Waiting for ${this.opponentName} to reconnect…</p>`
        : null}
      ${this._renderRoundBody()}

      <button type="button" class="secondary" @click=${this._onForfeit}>Forfeit</button>
    `
  }

  // The verse card + guess-form/locked-in/reveal area — split out of
  // render() because a failed verse resolution replaces this WHOLE block
  // with an error message rather than just hiding the verse text: showing
  // a guessable form for a round I can't even see the verse of would be
  // actively misleading (this is the fix for the real bug where a player
  // with a translation/file mismatch saw the guess form fully interactive
  // next to an unrelated error banner). The round still resolves normally
  // via the opponent's guess or the timer even when I can't participate.
  private _renderRoundBody() {
    if (this.verseResolutionError) {
      return html`
        <p class="verse-error">
          ${this.verseResolutionError} You can't guess this round, but it'll still resolve once
          ${this.opponentName} guesses${this._deadline ? ' or the timer runs out' : ''}.
        </p>
      `
    }

    return html`
      <bg-verse-card .verse=${this.resolvedVerse} .revealed=${this._revealed}></bg-verse-card>

      ${this._revealed
        ? this._renderRoundReveal()
        : this.myGuess
          ? html`<p class="locked-in">Guess locked in — waiting for ${this.opponentName}…</p>`
          : html`<bg-guess-form
              .disabled=${!this.resolvedVerse}
              .translation=${this.translation}
              .verseSource=${this.verseSource}
              .allowedBooks=${this.guessFormRestriction.allowedBooks}
              .lockedBook=${this.guessFormRestriction.lockedBook}
              .allowedChapters=${this.guessFormRestriction.allowedChapters}
              @guess-submitted=${this._onGuessSubmitted}
            ></bg-guess-form>`}
    `
  }

  private _renderCountdown() {
    const remaining = computeRemainingSeconds(this._deadline, this._now)
    if (remaining === undefined) return html`<span class="timer timer-infinite" title="No time limit">∞</span>`
    return html`<span class="timer ${remaining <= 5 ? 'urgent' : ''}">${remaining}s</span>`
  }

  private _renderRoundReveal() {
    if (this.session?.round.Case !== 'Scored') return null
    const [, results] = this.session.round.Fields
    const myResult = results.find((r) => r.playerId === this.myPlayerId)
    const opponentResult = results.find((r) => r.playerId === this.opponentId)

    return html`
      <div class="reveal">
        <p class="reveal-line">
          You: ${myResult ? `+${myResult.pointsAwarded} points` : 'No guess submitted'}
        </p>
        <p class="reveal-line">
          ${this.opponentName}: ${opponentResult ? `+${opponentResult.pointsAwarded} points` : 'No guess submitted'}
        </p>
      </div>
    `
  }

  // Resolves MY OWN book number for the guessed book (see
  // game-type.ts's bookNumberOfGuess) before submitting — this is what
  // lets the server score the guess by number instead of name (see
  // Guess.bookNumber's doc comment), fixing the bug where a correct
  // guess against a differently-spelled book would score as wrong.
  private _onGuessSubmitted(event: CustomEvent<Guess>) {
    this.myGuess = event.detail

    const resolveBookNumber = this.verseSource
      ? bookNumberOfGuess(event.detail.book, this.verseSource, this.translation)
      : Promise.resolve(undefined)

    resolveBookNumber
      .then((bookNumber) => submitGuess({ ...event.detail, bookNumber }))
      .catch((err) => {
        console.error('[bg-multiplayer-game] failed to submit guess', err)
      })
  }

  // Calls the server to forfeit — deliberately does NOT fire game-ended
  // itself. The server's GameOver broadcast (see onGameOver above) reaches
  // both players, me included, the same way a normal completion does, so
  // my own results screen appears via that one shared path rather than a
  // separate local teardown racing the server round-trip.
  private _onForfeit() {
    if (!window.confirm(`Leave your game with ${this.opponentName}? This forfeits the game.`)) return
    forfeitGame().catch((err) => {
      console.error('[bg-multiplayer-game] failed to forfeit game', err)
    })
  }

  static styles = css`
    :host {
      display: block;
    }

    .loading {
      opacity: 0.7;
    }

    .mp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .scoreboard {
      display: flex;
      gap: 1rem;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .opponent.disconnected {
      opacity: 0.6;
      text-decoration: line-through;
    }

    .round-label {
      opacity: 0.7;
      font-weight: 400;
    }

    .timer {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 1.1rem;
      opacity: 0.8;
    }

    .timer.urgent {
      color: #d33;
    }

    .timer-infinite {
      opacity: 0.5;
    }

    .opponent-status {
      font-size: 0.85rem;
      color: #d33;
      margin: 0 0 0.75rem;
    }

    .verse-error {
      padding: 2rem;
      border-radius: 12px;
      background: rgba(221, 51, 51, 0.08);
      color: #d33;
      font-size: 0.9rem;
    }

    .locked-in {
      margin: 1rem 0;
      opacity: 0.8;
    }

    .reveal {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: rgba(170, 59, 255, 0.08);
    }

    .reveal-line {
      margin: 0.2rem 0;
      font-weight: 600;
    }

    button.secondary {
      margin-top: 1rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid #d33;
      background: transparent;
      color: #d33;
      font-size: 0.85rem;
      cursor: pointer;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-multiplayer-game': MultiplayerGame
  }
}
