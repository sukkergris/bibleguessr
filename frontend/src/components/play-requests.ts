import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { describeGameType } from '../game-type'
import type { PlayRequest } from '../types'

/**
 * The list of play requests addressed to the viewing player, shown below
 * the chat window — see docs/SCRUM/Feature.StartMPGame.md and
 * docs/SCRUM/Feature.RequestToStartMPGame.md. Also shows the player's own
 * outstanding sent request (if any), with a Withdraw button. Each incoming
 * request shows the game type the challenger chose (see game-type.ts) and
 * Accept/Deny buttons.
 *
 * Accepting/denying only resolves the request itself — actually starting a
 * synced game (picking a shared verse, syncing rounds) depends on round
 * sync, which isn't built yet, so that stays a separate future feature.
 *
 * Dumb view component, same pattern as chat-panel.ts: the parent owns the
 * `requests`/`sentRequestToId` state and the actual SignalR calls, this
 * only fires CustomEvents when the player clicks a button.
 */
@customElement('bg-play-requests')
export class PlayRequests extends LitElement {
  /** Requests addressed to the viewing player (already filtered by the
   * parent to `toPlayerId === myPlayerId`). */
  @property({ attribute: false })
  requests: PlayRequest[] = []

  /** The name of the player the viewer's own outstanding request (if any)
   * was sent to — undefined if they haven't sent one. */
  @property({ attribute: false })
  sentRequestToName?: string

  render() {
    return html`
      <div class="panel">
        <h2>Play requests</h2>

        ${this.sentRequestToName
          ? html`
              <p class="sent">
                Request sent to <strong>${this.sentRequestToName}</strong>
                <button type="button" @click=${this._onWithdraw}>Withdraw</button>
              </p>
            `
          : null}
        ${this.requests.length === 0 && !this.sentRequestToName
          ? html`<p class="empty">No play requests yet — click a player's name in the list above to invite them.</p>`
          : null}
        ${this.requests.length > 0
          ? html`
              <ul>
                ${this.requests.map(
                  (r) => html`
                    <li>
                      <span>
                        <strong>${r.fromPlayerName}</strong> wants to play
                        <span class="game-type">${describeGameType(r.gameType)}</span>
                      </span>
                      <span class="actions">
                        <button type="button" @click=${() => this._onAccept(r.fromPlayerId)}>Accept</button>
                        <button type="button" class="deny" @click=${() => this._onDeny(r.fromPlayerId)}>Deny</button>
                      </span>
                    </li>
                  `,
                )}
              </ul>
            `
          : null}
      </div>
    `
  }

  private _onWithdraw() {
    this.dispatchEvent(new CustomEvent('withdraw-play-request', { bubbles: true, composed: true }))
  }

  private _onAccept(fromPlayerId: string) {
    this.dispatchEvent(
      new CustomEvent<string>('accept-play-request', { detail: fromPlayerId, bubbles: true, composed: true }),
    )
  }

  private _onDeny(fromPlayerId: string) {
    this.dispatchEvent(
      new CustomEvent<string>('deny-play-request', { detail: fromPlayerId, bubbles: true, composed: true }),
    )
  }

  static styles = css`
    :host {
      display: block;
    }

    h2 {
      font-size: 1rem;
      margin: 0 0 0.5rem;
    }

    .empty {
      font-size: 0.9rem;
      opacity: 0.7;
      margin: 0;
    }

    .sent {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      margin: 0 0 0.5rem;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      background: rgba(170, 59, 255, 0.08);
      font-size: 0.9rem;
    }

    .game-type {
      display: block;
      font-size: 0.8rem;
      opacity: 0.7;
    }

    .actions {
      display: flex;
      gap: 0.4rem;
      flex: none;
    }

    button {
      padding: 0.3rem 0.75rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 0.85rem;
      cursor: pointer;
    }

    button.deny {
      background: transparent;
      color: #d33;
      border: 1px solid #d33;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-play-requests': PlayRequests
  }
}
