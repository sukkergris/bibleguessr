import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import {
  joinRoom,
  joinWorldChat,
  onChatHistory,
  onChatMessage,
  onConnectionStateChange,
  onHubError,
  onPlayerDisconnected,
  onPlayerJoined,
  onPlayerLeft,
  onPlayRequestReceived,
  onPlayRequestWithdrawn,
  onRoomPlayers,
  sendChatMessage,
  sendPlayRequest,
  withdrawPlayRequest,
  type ConnectionState,
} from '../signalr-client'
import type { ChatMessage, PlayRequest, Player } from '../types'
import { loadRememberedPlayerName, saveRememberedPlayerName } from '../player-name-storage'
import './chat-panel'
import './play-requests'

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

  // Pre-filled from this browser's remembered name (if any) — see
  // player-name-storage.ts. Just a convenience: the server still mints a
  // fresh identity on every join, this only saves retyping the name.
  @state()
  private playerNameInput = loadRememberedPlayerName()

  @state()
  private players: Player[] = []

  /** Ids of players in `players` whose connection is currently down (per
   * PlayerDisconnected) but who haven't been removed yet (haven't hit
   * PlayerLeft) — rendered as a "struggling with their connection"
   * indicator rather than removed outright. */
  @state()
  private disconnectedPlayerIds = new Set<string>()

  @state()
  private messages: ChatMessage[] = []

  @state()
  private myPlayerId = ''

  /** Requests addressed to me. */
  @state()
  private playRequests: PlayRequest[] = []

  /** My own outstanding sent request's target id, if any. */
  @state()
  private sentRequestToId?: string

  @state()
  private error?: string

  @state()
  private connectionState: ConnectionState = 'connected'

  private _unsubscribePlayerJoined?: () => void
  private _unsubscribeChatMessage?: () => void
  private _unsubscribeChatHistory?: () => void
  private _unsubscribeHubError?: () => void
  private _unsubscribeConnectionState?: () => void
  private _unsubscribeRoomPlayers?: () => void
  private _unsubscribePlayRequestReceived?: () => void
  private _unsubscribePlayRequestWithdrawn?: () => void
  private _unsubscribePlayerDisconnected?: () => void
  private _unsubscribePlayerLeft?: () => void

  disconnectedCallback() {
    this._unsubscribePlayerJoined?.()
    this._unsubscribeChatMessage?.()
    this._unsubscribeChatHistory?.()
    this._unsubscribeHubError?.()
    this._unsubscribeConnectionState?.()
    this._unsubscribeRoomPlayers?.()
    this._unsubscribePlayRequestReceived?.()
    this._unsubscribePlayRequestWithdrawn?.()
    this._unsubscribePlayerDisconnected?.()
    this._unsubscribePlayerLeft?.()
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
    const isDisconnected = this.connectionState === 'disconnected'

    return html`
      <div class="room">
        <h1 class=${isDisconnected ? 'disconnected' : ''}>
          ${roomCode ? html`Room <span class="code">${roomCode}</span>` : 'World chat'}
        </h1>

        ${isDisconnected ? html`<p class="error">Lost connection to the server — trying to reconnect…</p>` : null}
        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <bg-chat-panel
          .players=${this.players}
          .messages=${this.messages}
          .myPlayerId=${this.myPlayerId}
          .disconnectedPlayerIds=${this.disconnectedPlayerIds}
          @chat-submit=${this._onChatSubmit}
          @player-selected=${this._onPlayerSelected}
        ></bg-chat-panel>

        <bg-play-requests
          .requests=${this.playRequests}
          .sentRequestToName=${this._sentRequestToName()}
          @withdraw-play-request=${this._onWithdrawPlayRequest}
        ></bg-play-requests>

        <button type="button" class="secondary" @click=${this._onLeaveRoom}>Back to chat selection</button>
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

  private async _enterRoom(
    roomCode: string | undefined,
    playerName: string,
    join: () => Promise<Player>,
  ) {
    this._unsubscribePlayerJoined = onPlayerJoined((player) => {
      this.players = [...this.players, player]
    })
    this._unsubscribeChatMessage = onChatMessage((message) => {
      this.messages = [...this.messages, message]
    })
    // Fires once, right after join, with the room's recent history —
    // prepend it ahead of whatever's arrived since (there shouldn't be
    // anything yet in practice, but this keeps chronological order either
    // way rather than assuming history always lands first).
    this._unsubscribeChatHistory = onChatHistory((history) => {
      this.messages = [...history, ...this.messages]
    })
    // A full, authoritative roster snapshot — replace wholesale rather
    // than append, so it self-corrects regardless of what PlayerJoined
    // appended in between (including a double-add of ourselves).
    this._unsubscribeRoomPlayers = onRoomPlayers((players) => {
      this.players = players
    })
    this._unsubscribePlayRequestReceived = onPlayRequestReceived((request) => {
      if (request.fromPlayerId === this.myPlayerId) {
        // Echo of my own just-sent (or retargeted) request.
        this.sentRequestToId = request.toPlayerId
        return
      }
      if (request.toPlayerId !== this.myPlayerId) return

      const withoutSameSender = this.playRequests.filter((r) => r.fromPlayerId !== request.fromPlayerId)
      this.playRequests = [...withoutSameSender, request]
    })
    this._unsubscribePlayRequestWithdrawn = onPlayRequestWithdrawn((fromPlayerId) => {
      if (fromPlayerId === this.myPlayerId) {
        this.sentRequestToId = undefined
      }
      this.playRequests = this.playRequests.filter((r) => r.fromPlayerId !== fromPlayerId)
    })
    this._unsubscribeHubError = onHubError((message) => {
      this.error = message
    })
    this._unsubscribeConnectionState = onConnectionStateChange((state) => {
      this.connectionState = state
    })
    this._unsubscribePlayerDisconnected = onPlayerDisconnected((playerId) => {
      this.disconnectedPlayerIds = new Set(this.disconnectedPlayerIds).add(playerId)
    })
    this._unsubscribePlayerLeft = onPlayerLeft((playerId) => {
      this.players = this.players.filter((p) => p.id !== playerId)
      this.playRequests = this.playRequests.filter((r) => r.fromPlayerId !== playerId)
      if (this.sentRequestToId === playerId) this.sentRequestToId = undefined

      const stillDisconnected = new Set(this.disconnectedPlayerIds)
      stillDisconnected.delete(playerId)
      this.disconnectedPlayerIds = stillDisconnected
    })

    const me = await join()
    this.myPlayerId = me.id
    saveRememberedPlayerName(playerName)
    this.screen = { step: 'in-room', roomCode, playerName }
  }

  private _onChatSubmit(event: CustomEvent<string>) {
    sendChatMessage(event.detail).catch((err) => {
      console.error('[bg-room-setup] failed to send chat message', err)
    })
  }

  private _onPlayerSelected(event: CustomEvent<string>) {
    sendPlayRequest(event.detail).catch((err) => {
      console.error('[bg-room-setup] failed to send play request', err)
    })
  }

  private _onWithdrawPlayRequest() {
    withdrawPlayRequest().catch((err) => {
      console.error('[bg-room-setup] failed to withdraw play request', err)
    })
  }

  private _sentRequestToName(): string | undefined {
    if (!this.sentRequestToId) return undefined
    return this.players.find((p) => p.id === this.sentRequestToId)?.name
  }

  // Leaves the current room/World chat back to the create-or-join screen.
  // The underlying hub connection stays up (it's a shared singleton the
  // app may reuse elsewhere) — this only stops listening locally and
  // resets this component's own state, it doesn't tell the server the
  // player left.
  private _onLeaveRoom() {
    this._unsubscribePlayerJoined?.()
    this._unsubscribeChatMessage?.()
    this._unsubscribeChatHistory?.()
    this._unsubscribeHubError?.()
    this._unsubscribeConnectionState?.()
    this._unsubscribeRoomPlayers?.()
    this._unsubscribePlayRequestReceived?.()
    this._unsubscribePlayRequestWithdrawn?.()
    this._unsubscribePlayerDisconnected?.()
    this._unsubscribePlayerLeft?.()

    this.players = []
    this.messages = []
    this.myPlayerId = ''
    this.playRequests = []
    this.sentRequestToId = undefined
    this.disconnectedPlayerIds = new Set()
    this.error = undefined
    this.connectionState = 'connected'
    this.screen = { step: 'choose' }
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

    h1.disconnected {
      text-decoration: line-through;
      opacity: 0.6;
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
