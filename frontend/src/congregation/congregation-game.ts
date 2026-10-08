import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { guessConstraintForWire } from '../game-types/registry'
import { bookNumberOfGuess } from '../shared-kernel/book-numbers'
import { ANY_BOOK, type GuessConstraint } from '../shared-kernel/guess-constraint'
import { forfeitGame, submitGuess } from '../signalr-client'
import { buttonStyles } from '../shared-ui/button-styles'
import { computeRemainingSeconds, deadlineOf } from '../timer'
import type { GameSession, Guess, LeaderboardSnapshot, Verse, VerseReference, VerseSource } from '../types'
import '../shared-ui/verse-card'
import '../shared-ui/guess-form'
import './leaderboard-table'

/** How often the countdown redraws — cosmetic only; the server decides
 * when a round ends. */
const COUNTDOWN_TICK_MS = 250

const sameReference = (a?: VerseReference, b?: VerseReference) =>
  a?.book === b?.book && a?.chapter === b?.chapter && a?.verseNumber === b?.verseNumber

/**
 * A Congregation round, as one participant plays it — see
 * docs/web/congregation. Everything it shows comes from the room screen
 * (bg-room-setup.ts, via congregation-controller.ts): the latest session
 * and leaderboard. The verse TEXT is resolved here, from this player's
 * own Bible — the server only ever sends the reference.
 *
 * Unlike the duel screen there is no flashing final countdown: a
 * Congregation is often played in one room around one screen, and a
 * plain countdown is calmer for everyone there.
 */
@customElement('bg-congregation-game')
export class CongregationGameView extends LitElement {
  @property({ attribute: false })
  session!: GameSession

  @property({ attribute: false })
  board?: LeaderboardSnapshot

  @property({ attribute: false })
  myPlayerId = ''

  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  @state()
  private resolvedVerse?: Verse

  @state()
  private verseResolutionError?: string

  @state()
  private guessConstraint: GuessConstraint = ANY_BOOK

  /** The round index this player submitted a guess for, if any. */
  @state()
  private guessedRound?: number

  @state()
  private now = Date.now()

  @state()
  private leaveDialogOpen = false

  @state()
  private leaveError?: string

  private leaveTrigger?: HTMLElement
  private tickHandle?: ReturnType<typeof setInterval>
  private constraintFor?: string

  connectedCallback() {
    super.connectedCallback()
    this.tickHandle = setInterval(() => (this.now = Date.now()), COUNTDOWN_TICK_MS)
  }

  disconnectedCallback() {
    if (this.tickHandle !== undefined) clearInterval(this.tickHandle)
    super.disconnectedCallback()
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (!changed.has('session') && !changed.has('verseSource')) return

    const previous = changed.get('session') as GameSession | undefined
    if (!sameReference(this.referenceOf(previous), this.referenceOf(this.session)) || changed.has('verseSource')) {
      this.resolveVerse()
    }
    if (this.constraintFor !== this.session.gameId) this.resolveConstraint()
  }

  private referenceOf(session?: GameSession): VerseReference | undefined {
    const round = session?.round
    return round && round.Case !== 'WaitingForPlayers' ? round.Fields[0] : undefined
  }

  private resolveVerse() {
    const reference = this.referenceOf(this.session)
    this.resolvedVerse = undefined
    this.verseResolutionError = undefined
    if (!reference || !this.verseSource) return

    this.verseSource
      .lookupVerse(reference, this.translation)
      .then((verse) => {
        if (sameReference(this.referenceOf(this.session), reference)) this.resolvedVerse = verse
      })
      .catch((err) => {
        if (!sameReference(this.referenceOf(this.session), reference)) return
        console.error('[bg-congregation-game] failed to resolve verse reference', err)
        this.verseResolutionError =
          err instanceof Error ? err.message : "This verse isn't available in your chosen translation or file."
      })
  }

  private resolveConstraint() {
    if (!this.verseSource) return
    this.constraintFor = this.session.gameId
    guessConstraintForWire(this.session.gameType, this.verseSource, this.translation)
      .then((constraint) => (this.guessConstraint = constraint))
      .catch((err) => console.error('[bg-congregation-game] failed to resolve the guess constraint', err))
  }

  private get revealed() {
    return this.session.round.Case === 'Scored'
  }

  private get lockedIn() {
    if (this.revealed) return false
    if (this.guessedRound === this.session.roundIndex) return true
    // A player who reloaded mid-round got their seat back with the guess
    // they had already made — the board says so.
    const mine = this.board?.entries.find((e) => e.playerId === this.myPlayerId)
    const boardRound = this.board?.round
    return (
      !!mine?.guessedThisRound &&
      boardRound?.Case === 'Guessing' &&
      boardRound.Fields[0] === this.session.roundIndex + 1
    )
  }

  render() {
    const myScore = this.session.scores[this.myPlayerId] ?? 0
    const remaining = computeRemainingSeconds(deadlineOf(this.session.roundStartedAt, this.session.roundTimeLimit), this.now)

    return html`
      <header class="header">
        <span class="round">Verse ${this.session.roundIndex + 1} of ${this.session.roundCount}</span>
        <span class="score">Your score: ${myScore}</span>
        ${this.revealed || remaining === undefined
          ? null
          : html`<span class="timer ${remaining <= 5 ? 'urgent' : ''}">${remaining}s left</span>`}
      </header>

      ${this.renderRound()}

      <bg-leaderboard-table
        .entries=${this.board?.entries ?? []}
        .round=${this.board?.round ?? { Case: 'NotStarted' }}
        .myPlayerId=${this.myPlayerId}
        caption="Leaderboard"
      ></bg-leaderboard-table>

      <button type="button" class="compact danger leave" @click=${this.openLeaveDialog}>Leave the game</button>
      ${this.leaveDialogOpen ? this.renderLeaveDialog() : null}
    `
  }

  private renderRound() {
    if (this.verseResolutionError) {
      return html`
        <p class="verse-error">
          ${this.verseResolutionError} You can't guess this verse, but the game goes on once the others
          have guessed or the time is up.
        </p>
      `
    }

    return html`
      <bg-verse-card .verse=${this.resolvedVerse} .revealed=${this.revealed}></bg-verse-card>
      ${this.revealed
        ? this.renderReveal()
        : this.lockedIn
          ? html`<p class="locked-in" role="status">${this.waitingText()}</p>`
          : html`
              <bg-guess-form
                .disabled=${!this.resolvedVerse}
                .translation=${this.translation}
                .verseSource=${this.verseSource}
                .constraint=${this.guessConstraint}
                @guess-submitted=${this.onGuessSubmitted}
              ></bg-guess-form>
            `}
    `
  }

  private waitingText() {
    const entries = this.board?.entries.filter((e) => e.status.Case !== 'Left') ?? []
    const guessed = entries.filter((e) => e.guessedThisRound).length
    return entries.length > 0
      ? `Guess locked in. ${guessed} of ${entries.length} players have guessed.`
      : 'Guess locked in. Waiting for the others…'
  }

  private renderReveal() {
    if (this.session.round.Case !== 'Scored') return null
    const [, results] = this.session.round.Fields
    const mine = results.find((r) => r.playerId === this.myPlayerId)
    const last = this.session.roundIndex + 1 >= this.session.roundCount

    return html`
      <div class="reveal" role="status">
        <p>${mine ? `You scored ${mine.pointsAwarded} points.` : "You didn't guess this verse."}</p>
        <p class="next">${last ? 'Final standings coming up…' : 'Next verse in a moment…'}</p>
      </div>
    `
  }

  private onGuessSubmitted(event: CustomEvent<Guess>) {
    this.guessedRound = this.session.roundIndex

    const resolveBookNumber = this.verseSource
      ? bookNumberOfGuess(event.detail.book, this.verseSource, this.translation)
      : Promise.resolve(undefined)

    resolveBookNumber
      .then((bookNumber) => submitGuess({ ...event.detail, bookNumber }))
      .catch((err) => console.error('[bg-congregation-game] failed to submit guess', err))
  }

  private renderLeaveDialog() {
    return html`
      <div class="dialog-backdrop" @click=${this.onBackdropClick}>
        <section
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-title"
          aria-describedby="leave-description"
          @keydown=${this.onDialogKeydown}
        >
          <h2 id="leave-title">Leave the game?</h2>
          <p id="leave-description">
            The others play on without you. Your points so far stay on the leaderboard.
          </p>
          ${this.leaveError ? html`<p class="error" role="alert">${this.leaveError}</p>` : null}
          <div class="dialog-actions">
            <button type="button" class="secondary" data-leave-cancel @click=${this.closeLeaveDialog}>
              Stay
            </button>
            <button type="button" class="danger-solid" @click=${this.confirmLeave}>Leave</button>
          </div>
        </section>
      </div>
    `
  }

  private async openLeaveDialog(event: Event) {
    this.leaveTrigger = event.currentTarget as HTMLElement
    this.leaveError = undefined
    this.leaveDialogOpen = true
    await this.updateComplete
    this.shadowRoot?.querySelector<HTMLButtonElement>('[data-leave-cancel]')?.focus()
  }

  private closeLeaveDialog() {
    const trigger = this.leaveTrigger
    this.leaveDialogOpen = false
    this.leaveTrigger = undefined
    if (trigger?.isConnected) trigger.focus()
  }

  private onBackdropClick(event: Event) {
    if (event.target === event.currentTarget) this.closeLeaveDialog()
  }

  private onDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.closeLeaveDialog()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = event.currentTarget as HTMLElement
    const focusable = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = (dialog.getRootNode() as ShadowRoot).activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // The room screen moves on by itself once the server confirms (the
  // activity then shows this player as having left), so all that's left
  // here is reporting a failure.
  private confirmLeave() {
    forfeitGame().catch((err) => {
      console.error('[bg-congregation-game] failed to leave the game', err)
      this.leaveError = 'Leaving the game failed. Please try again.'
    })
  }

  static styles = [
    buttonStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem 1rem;
        font-weight: 600;
      }

      .round {
        color: var(--text-muted);
        font-weight: 400;
      }

      .timer {
        font-variant-numeric: tabular-nums;
        font-size: 1.1rem;
      }

      /* Urgency is also in the words ("5s left"), not just the color. */
      .timer.urgent {
        color: var(--error);
      }

      .verse-error {
        padding: 1.5rem;
        border-radius: 12px;
        color: var(--error);
        border: 1px solid var(--error);
      }

      .locked-in,
      .reveal p {
        margin: 0;
      }

      .reveal {
        padding: 0.75rem 1rem;
        border-radius: 8px;
        background: var(--surface);
        font-weight: 600;
      }

      .reveal .next {
        font-weight: 400;
        color: var(--text-muted);
      }

      .leave {
        align-self: flex-start;
      }

      .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: var(--overlay);
      }

      .dialog {
        width: min(24rem, 100%);
        padding: 1.25rem;
        border-radius: 12px;
        background: var(--surface-raised);
        color: var(--text);
      }

      .dialog h2 {
        margin: 0;
        font-size: 1.1rem;
      }

      .dialog p {
        margin: 0.75rem 0 1rem;
      }

      .error {
        color: var(--error);
        font-weight: 600;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-congregation-game': CongregationGameView
  }
}
