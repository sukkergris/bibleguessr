import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ChatMessage, Player } from '../types'
import type { ConnectionState } from '../signalr-client';

/**
 * The players list + message log + send form shared by any chat surface
 * (a room's lobby, World chat). Fires a `chat-submit` CustomEvent<string>
 * with the trimmed message text when the player sends one, and a
 * `player-selected` CustomEvent<string> (detail = the clicked player's id)
 * when the player clicks another player's name in the list — see
 * docs/SCRUM/Feature.StartMPGame.md. The parent owns the actual SignalR
 * calls and the `messages`/`players` state, so this component stays a
 * plain, reusable view.
 */
@customElement('bg-chat-panel')
export class ChatPanel extends LitElement {
  @property({ attribute: false })
  players: Player[] = [];

  @property({ attribute: false })
  messages: ChatMessage[] = [];

  /** The viewing player's own id, so their own name in the list isn't
   * rendered as a clickable play-request target. */
  @property({ attribute: false })
  myPlayerId = '';

  /** The local SignalR connection state, used to distinguish known presence
   * from uncertain presence while this browser is disconnected. */
  @property({ attribute: false })
  connectionState: ConnectionState = 'connected';

  /** Ids of players whose connection is currently down (but who haven't
   * been removed from `players` yet) — rendered as a status dot next to
   * their name, so everyone can tell "just struggling with their
   * connection" apart from "actually here". */
  @property({ attribute: false })
  disconnectedPlayerIds: Set<string> = new Set();

  @state()
  private _input = '';

  render() {
    // Partitioned by disconnectedPlayerIds — unambiguous per-player
    // server truth (see docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md)
    // — distinct from `connectionState`, which is only about THIS
    // viewer's own uncertain connection and still renders inline in
    // Online (see _renderOnlineRow).
    const onlinePlayers = this.players.filter((p) => !this.disconnectedPlayerIds.has(p.id));
    const offlinePlayers = this.players.filter((p) => this.disconnectedPlayerIds.has(p.id));

    return html`
      <div class="panel">
        <div class="players">
          <h2>Players</h2>
          <div class="section-label">Online</div>
          <ul>
            ${onlinePlayers.map((player) => this._renderOnlineRow(player))}
          </ul>

          ${offlinePlayers.length > 0
            ? html`
                <div class="section-label">Offline</div>
                <ul class="offline">
                  ${offlinePlayers.map((player) => this._renderOfflineRow(player))}
                </ul>
              `
            : null}
        </div>

        <div class="chat">
          <h2>Chat</h2>
          <ul class="messages">
            ${this.messages.map(
              (m) => html`
                <li>
                  <strong>${m.playerName}:</strong>
                  ${m.text}
                </li>
              `
            )}
          </ul>
          <form class="chat-input" @submit=${this._onSubmit}>
            <input
              type="text"
              .value=${this._input}
              @input=${(e: Event) =>
                (this._input = (e.target as HTMLInputElement).value)}
              placeholder="Say something…"
              maxlength="500"
            />
            <button type="submit" ?disabled=${!this._input.trim()}>Send</button>
          </form>
        </div>
      </div>
    `;
  }

  // Renders one row in the Online section — includes the connected/
  // connection-trouble/unknown status dot, since within Online that's
  // still genuinely ambiguous info (is THIS viewer's own connection
  // uncertain right now?). A disconnected player never reaches this
  // method — see the Offline partition in render().
  private _renderOnlineRow(player: Player) {
    const isMe = player.id === this.myPlayerId;
    const isUncertain = this.connectionState === 'disconnected';
    const statusClass = isUncertain ? (isMe ? 'disconnected' : 'unknown') : 'connected';
    const statusLabel =
      statusClass === 'disconnected' ? 'Disconnected' : statusClass === 'unknown' ? 'Unknown' : 'Connected';
    const dot = html` <span class="status-dot ${statusClass}" title=${statusLabel}></span> `;

    return isMe
      ? html`
          <li>
            ${dot}${player.name}
            <span class="you">(you)</span>
          </li>
        `
      : html`
          <li class="clickable" @click=${() => this._onPlayerSelected(player.id)}>${dot}${player.name}</li>
        `;
  }

  // Renders one row in the Offline section — no status dot (the section
  // itself already says "offline"), and deliberately no `class="clickable"`/
  // `@click` at all: a disconnected player can't be invited (see
  // docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md), and
  // structurally never attaching a click handler is simpler and more
  // honest than attaching one and guarding inside it.
  private _renderOfflineRow(player: Player) {
    const isMe = player.id === this.myPlayerId;

    return html`
      <li class="offline-row">
        ${player.name}${isMe ? html`<span class="you">(you)</span>` : null}
      </li>
    `;
  }

  private _onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const text = this._input.trim();
    if (!text) return;

    this._input = '';
    this.dispatchEvent(
      new CustomEvent<string>('chat-submit', {
        detail: text,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onPlayerSelected(playerId: string) {
    this.dispatchEvent(
      new CustomEvent<string>('player-selected', {
        detail: playerId,
        bubbles: true,
        composed: true,
      })
    );
  }

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    h2 {
      font-size: 1rem;
      margin: 0 0 0.5rem;
    }

    .players ul,
    .messages {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .players ul li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      background: rgba(170, 59, 255, 0.08);
    }

    .status-dot {
      flex: none;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
    }

    .status-dot.connected {
      background: #22c55e;
    }

    .status-dot.disconnected {
      background: #d33;
    }

    .status-dot.unknown {
      background: #9ca3af;
    }

    .players ul li.clickable {
      cursor: pointer;
    }

    .players ul li.clickable:hover {
      background: rgba(170, 59, 255, 0.18);
    }

    .section-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      opacity: 0.55;
      margin: 0.6rem 0 0.3rem;
    }

    .section-label:first-of-type {
      margin-top: 0;
    }

    .players ul li.offline-row {
      background: rgba(0, 0, 0, 0.04);
      opacity: 0.55;
      cursor: default;
    }

    .you {
      opacity: 0.6;
      font-size: 0.85em;
    }

    .messages {
      max-height: 16rem;
      overflow-y: auto;
      margin-bottom: 0.5rem;
    }

    .messages li {
      font-size: 0.9rem;
    }

    .chat-input {
      display: flex;
      gap: 0.5rem;
    }

    .chat-input input {
      flex: 1;
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }

    button {
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      border: none;
      background: #aa3bff;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-chat-panel': ChatPanel
  }
}
