import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { joinRoom, onChatMessage, onHubError, onPlayerJoined, sendChatMessage } from '../signalr-client'
import type { ChatMessage } from '../types'

type Screen =
  | { step: 'choose' }
  | { step: 'creating' }
  | { step: 'joining' }
  | { step: 'in-room'; roomCode: string; playerName: string }

/**
 * Multiplayer entry point: create a new room or join one by code, then land
 * in a lobby with the joined-players list and a chat panel. Round/scoring
 * sync isn't built yet — this is the room + chat foundation it'll build on.
 */
@customElement('bg-room-setup')
export class RoomSetup extends LitElement {
  @state()
  private screen: Screen = { step: 'choose' }

  @state()
  private roomCodeInput = ''

  @state()
  private playerNameInput = ''

  @state()
  private players: string[] = []

  @state()
  private messages: ChatMessage[] = []

  @state()
  private chatInput = ''

  @state()
  private error?: string

  private _unsubscribePlayerJoined?: () => void
  private _unsubscribeChatMessage?: () => void
  private _unsubscribeHubError?: () => void

  disconnectedCallback() {
    this._unsubscribePlayerJoined?.()
    this._unsubscribeChatMessage?.()
    this._unsubscribeHubError?.()
    super.disconnectedCallback()
  }

  render() {
    if (this.screen.step === 'in-room') {
      return this._renderRoom(this.screen.roomCode, this.screen.playerName)
    }
    return this._renderChoose()
  }

  private _renderChoose() {
    const isBusy = this.screen.step === 'creating' || this.screen.step === 'joining'

    return html`
      <div class="setup">
        <h1>Multiplayer</h1>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <label>
          Your name
          <input
            type="text"
            .value=${this.playerNameInput}
            @input=${(e: Event) => (this.playerNameInput = (e.target as HTMLInputElement).value)}
            placeholder="e.g. Alice"
          />
        </label>

        <button type="button" ?disabled=${isBusy || !this.playerNameInput.trim()} @click=${this._onCreateRoom}>
          Create a room
        </button>

        <div class="join">
          <input
            type="text"
            .value=${this.roomCodeInput}
            @input=${(e: Event) => (this.roomCodeInput = (e.target as HTMLInputElement).value)}
            placeholder="Room code"
            maxlength="4"
          />
          <button
            type="button"
            ?disabled=${isBusy || !this.playerNameInput.trim() || !this.roomCodeInput.trim()}
            @click=${this._onJoinRoom}
          >
            Join
          </button>
        </div>
      </div>
    `
  }

  private _renderRoom(roomCode: string, _playerName: string) {
    return html`
      <div class="room">
        <h1>Room <span class="code">${roomCode}</span></h1>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <div class="players">
          <h2>Players</h2>
          <ul>
            ${this.players.map((name) => html`<li>${name}</li>`)}
          </ul>
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
              `,
            )}
          </ul>
          <form class="chat-input" @submit=${this._onSendChat}>
            <input
              type="text"
              .value=${this.chatInput}
              @input=${(e: Event) => (this.chatInput = (e.target as HTMLInputElement).value)}
              placeholder="Say something…"
              maxlength="500"
            />
            <button type="submit" ?disabled=${!this.chatInput.trim()}>Send</button>
          </form>
        </div>
      </div>
    `
  }

  private async _onCreateRoom() {
    this.error = undefined
    this.screen = { step: 'creating' }
    try {
      const room = await api.createRoom()
      await this._enterRoom(room.code, this.playerNameInput.trim())
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create a room.'
      this.screen = { step: 'choose' }
    }
  }

  private async _onJoinRoom() {
    this.error = undefined
    this.screen = { step: 'joining' }
    try {
      await this._enterRoom(this.roomCodeInput.trim(), this.playerNameInput.trim())
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to join the room.'
      this.screen = { step: 'choose' }
    }
  }

  private async _enterRoom(roomCode: string, playerName: string) {
    this._unsubscribePlayerJoined = onPlayerJoined((name) => {
      this.players = [...this.players, name]
    })
    this._unsubscribeChatMessage = onChatMessage((message) => {
      this.messages = [...this.messages, message]
    })
    this._unsubscribeHubError = onHubError((message) => {
      this.error = message
    })

    await joinRoom(roomCode, playerName)
    this.screen = { step: 'in-room', roomCode, playerName }
  }

  private _onSendChat(event: SubmitEvent) {
    event.preventDefault()
    const text = this.chatInput.trim()
    if (!text) return

    this.chatInput = ''
    sendChatMessage(text).catch((err) => {
      console.error('[bg-room-setup] failed to send chat message', err)
    })
  }

  static styles = css`
    :host {
      display: block;
    }

    .setup,
    .room {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    h1 {
      font-size: 1.5rem;
      margin: 0;
      text-align: center;
    }

    .code {
      font-family: monospace;
      color: #aa3bff;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.9rem;
    }

    input {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }

    .join {
      display: flex;
      gap: 0.5rem;
    }

    .join input {
      flex: 1;
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

    .error {
      color: #d33;
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
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      background: rgba(170, 59, 255, 0.08);
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
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-room-setup': RoomSetup
  }
}
