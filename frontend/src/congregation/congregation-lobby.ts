import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { describeWire } from '../game-types/registry'
import { cancelCongregation, joinCongregation, leaveCongregation, startCongregation } from '../signalr-client'
import { buttonStyles } from '../shared-ui/button-styles'
import { SHARE_OUTCOME_MESSAGES, gameUrl, shareOrCopy } from '../shared-ui/share-or-copy'
import { parseTimeSpanMs } from '../timer'
import type { CongregationLobby, CongregationRules, VerseSource } from '../types'
import { watchUrlFor } from './watch-route'

const MS_PER_SECOND = 1000

/**
 * An open Congregation lobby, as each player in the room sees it — see
 * docs/web/congregation. The host sees who has joined, the link for the
 * spectator board, and Start/Cancel; everyone else can join or leave.
 * Every action goes straight to the server; what this shows changes only
 * when the server says so (RoomActivityChanged), never optimistically.
 */
@customElement('bg-congregation-lobby')
export class CongregationLobbyView extends LitElement {
  @property({ attribute: false })
  lobby!: CongregationLobby

  @property({ attribute: false })
  role: 'host' | 'member' | 'outsider' = 'outsider'

  @property({ attribute: false })
  rules?: CongregationRules

  @property({ attribute: false })
  roomCode = ''

  /** Members whose connection is down — they don't count towards the
   * minimum, since the server starts the game with connected members only. */
  @property({ attribute: false })
  disconnectedPlayerIds: ReadonlySet<string> = new Set()

  @property({ attribute: false })
  verseSource?: VerseSource

  @property({ attribute: false })
  translation?: string

  @state()
  private gameDescription?: string

  @state()
  private linkStatus?: string

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('lobby') || changed.has('verseSource')) this.describeGame()
  }

  private describeGame() {
    if (!this.verseSource || !this.lobby) return
    const gameType = this.lobby.gameType
    describeWire(gameType, this.verseSource, this.translation)
      .then((description) => {
        if (this.lobby.gameType === gameType) this.gameDescription = description
      })
      .catch((err) => console.error('[bg-congregation-lobby] failed to describe the game type', err))
  }

  private get connectedCount() {
    return this.lobby.members.filter((m) => !this.disconnectedPlayerIds.has(m.id)).length
  }

  private get startBlockedReason(): string | undefined {
    const need = this.rules?.minPlayers
    if (need === undefined) return 'Loading the Congregation settings…'
    const have = this.connectedCount
    if (have < need) {
      const missing = need - have
      return `Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'} to join.`
    }
    return undefined
  }

  private get isFull() {
    return this.rules !== undefined && this.lobby.members.length >= this.rules.maxPlayers
  }

  render() {
    const seconds = Math.round(parseTimeSpanMs(this.lobby.roundTimeLimit) / MS_PER_SECOND)
    const watchUrl = watchUrlFor(gameUrl(), this.roomCode)

    return html`
      <section class="lobby" aria-labelledby="lobby-title">
        <h2 id="lobby-title">Congregation</h2>
        <p class="summary">
          Hosted by <strong>${this.lobby.host.name}</strong> ·
          ${this.gameDescription ?? 'Loading the game…'} · ${this.lobby.roundCount} verses ·
          ${seconds} seconds each
        </p>

        <h3>Players</h3>
        <p class="count">
          ${this.lobby.members.length} joined${this.rules
            ? html` · at least ${this.rules.minPlayers}, room for ${this.rules.maxPlayers}`
            : null}
        </p>
        <ul class="members">
          ${this.lobby.members.map(
            (m) => html`
              <li>
                ${m.name}${m.id === this.lobby.host.id ? ' (host)' : ''}${this.disconnectedPlayerIds.has(m.id)
                  ? ' (offline)'
                  : ''}
              </li>
            `,
          )}
        </ul>

        ${this.role === 'host' ? this.renderHostControls(watchUrl) : this.renderPlayerControls()}
      </section>
    `
  }

  private renderHostControls(watchUrl: string) {
    const blocked = this.startBlockedReason
    return html`
      <div class="actions">
        <button
          type="button"
          ?disabled=${blocked !== undefined}
          aria-describedby=${blocked ? 'start-blocked' : ''}
          @click=${this.onStart}
        >
          Start the game
        </button>
        <button type="button" class="secondary" @click=${this.onCancel}>Cancel the Congregation</button>
      </div>
      ${blocked ? html`<p id="start-blocked" class="hint">${blocked}</p>` : null}

      <div class="watch">
        <h3>Leaderboard for a screen</h3>
        <p class="hint">
          Open this link on a projector or TV to show the live leaderboard. It never shows the verse
          while players are guessing.
        </p>
        <p><a href=${watchUrl} target="_blank" rel="noopener">${watchUrl}</a></p>
        <button type="button" class="secondary compact" @click=${() => this.onShareLink(watchUrl)}>
          Copy link
        </button>
        <p class="hint" role="status">${this.linkStatus ?? ''}</p>
      </div>
    `
  }

  private renderPlayerControls() {
    if (this.role === 'member') {
      return html`
        <p role="status">You're in. Waiting for ${this.lobby.host.name} to start the game.</p>
        <div class="actions">
          <button type="button" class="secondary" @click=${this.onLeave}>Leave the Congregation</button>
        </div>
      `
    }

    return html`
      <div class="actions">
        <button
          type="button"
          ?disabled=${this.isFull}
          aria-describedby=${this.isFull ? 'join-blocked' : ''}
          @click=${this.onJoin}
        >
          Join the Congregation
        </button>
      </div>
      ${this.isFull ? html`<p id="join-blocked" class="hint">This Congregation is full.</p>` : null}
    `
  }

  private onStart() {
    startCongregation().catch((err) => console.error('[bg-congregation-lobby] failed to start', err))
  }

  private onCancel() {
    cancelCongregation().catch((err) => console.error('[bg-congregation-lobby] failed to cancel', err))
  }

  private onJoin() {
    joinCongregation().catch((err) => console.error('[bg-congregation-lobby] failed to join', err))
  }

  private onLeave() {
    leaveCongregation().catch((err) => console.error('[bg-congregation-lobby] failed to leave', err))
  }

  private async onShareLink(url: string) {
    const outcome = await shareOrCopy(url)
    this.linkStatus = outcome === 'copied' ? 'Link copied.' : SHARE_OUTCOME_MESSAGES[outcome]
  }

  static styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .lobby {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
      }

      h2,
      h3 {
        margin: 0;
      }

      h2 {
        font-size: 1.2rem;
      }

      h3 {
        font-size: 1rem;
        margin-top: 0.5rem;
      }

      .summary,
      .count,
      .hint {
        margin: 0;
      }

      .hint,
      .count {
        font-size: 0.85rem;
        color: var(--text-muted);
      }

      .members {
        margin: 0;
        padding-left: 1.25rem;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .watch {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
      }

      .watch p {
        margin: 0;
      }

      a {
        color: var(--link);
        word-break: break-all;
      }

      a:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-congregation-lobby': CongregationLobbyView
  }
}
