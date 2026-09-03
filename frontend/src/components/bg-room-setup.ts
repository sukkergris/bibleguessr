import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { joinRoom, joinWorldChat, onChatMessage, onHubError, onPlayerJoined, sendChatMessage } from '../signalr-client'
import type { ChatMessage } from '../types'
import './chat-panel'

type Screen =
  | { step: 'choose' }
  | { step: 'creating' }
  | { step: 'joining' }
  | { step: 'in-room'; roomCode?: string; playerName: string }

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
      return this._renderRoom(this.screen.roomCode)
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

        <button
          type="button"
          class="secondary"
          ?disabled=${isBusy || !this.playerNameInput.trim()}
          @click=${this._onJoinWorldChat}
        >
          Join World chat
        </button>
      </div>
    `
  }

  private _renderRoom(roomCode: string | undefined) {
    return html`
      <div class="room">
        <h1>${roomCode ? html`Room <span class="code">${roomCode}</span>` : 'World chat'}</h1>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <bg-chat-panel
          .players=${this.players}
          .messages=${this.messages}
          @chat-submit=${this._onChatSubmit}
        ></bg-chat-panel>
      </div>
    `
  }

  private async _onCreateRoom() {
    this.error = undefined
    this.screen = { step: 'creating' }
    const playerName = this.playerNameInput.trim()
    try {
      const room = await api.createRoom()
      await this._enterRoom(room.code, playerName, () => joinRoom(room.code, playerName))
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create a room.'
      this.screen = { step: 'choose' }
    }
  }

  private async _onJoinRoom() {
    this.error = undefined
    this.screen = { step: 'joining' }
    const playerName = this.playerNameInput.trim()
    const roomCode = this.roomCodeInput.trim()
    try {
      await this._enterRoom(roomCode, playerName, () => joinRoom(roomCode, playerName))
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to join the room.'
      this.screen = { step: 'choose' }
    }
  }

  private async _onJoinWorldChat() {
    this.error = undefined
    this.screen = { step: 'joining' }
    const playerName = this.playerNameInput.trim()
    try {
      await this._enterRoom(undefined, playerName, () => joinWorldChat(playerName))
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to join World chat.'
      this.screen = { step: 'choose' }
    }
  }

  private async _enterRoom(roomCode: string | undefined, playerName: string, join: () => Promise<void>) {
    this._unsubscribePlayerJoined = onPlayerJoined((name) => {
      this.players = [...this.players, name]
    })
    this._unsubscribeChatMessage = onChatMessage((message) => {
      this.messages = [...this.messages, message]
    })
    this._unsubscribeHubError = onHubError((message) => {
      this.error = message
    })

    await join()
    this.screen = { step: 'in-room', roomCode, playerName }
  }

  private _onChatSubmit(event: CustomEvent<string>) {
    sendChatMessage(event.detail).catch((err) => {
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

    button.secondary {
      background: transparent;
      color: #aa3bff;
      border: 1px solid #aa3bff;
    }

    .error {
      color: #d33;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-room-setup': RoomSetup
  }
}
