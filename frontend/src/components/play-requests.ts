import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { PlayRequest } from '../types'

/**
 * The list of play requests addressed to the viewing player, shown below
 * the chat window — see docs/SCRUM/Feature.StartMPGame.md. Also shows the
 * player's own outstanding sent request (if any), with a Withdraw button.
 *
 * Deliberately no accept/decline: accepting a request depends on round
 * sync, which isn't built yet, so a request just sits visible until its
 * sender withdraws it or retargets someone else (REPLACE semantics — see
 * backend/Domain/Game.fs's Room.sendPlayRequest).
 *
 * Dumb view component, same pattern as chat-panel.ts: the parent owns the
 * `requests`/`sentRequestToId` state and the actual SignalR call, this
 * only fires a `withdraw-play-request` CustomEvent when the player clicks
 * Withdraw.
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
                ${this.requests.map((r) => html`<li>${r.fromPlayerName} wants to play</li>`)}
              </ul>
            `
          : null}
      </div>
    `
  }

  private _onWithdraw() {
    this.dispatchEvent(new CustomEvent('withdraw-play-request', { bubbles: true, composed: true }))
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
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      background: rgba(170, 59, 255, 0.08);
      font-size: 0.9rem;
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
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-play-requests': PlayRequests
  }
}
