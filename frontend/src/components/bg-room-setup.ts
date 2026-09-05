import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { api } from '../api'
import { gameTypeFromRestriction } from '../game-type'
import {
  acceptPlayRequest,
  denyPlayRequest,
  joinRoom,
  joinWorldChat,
  leaveRoom,
  onChatHistory,
  onChatMessage,
  onConnectionStateChange,
  onGameOver,
  onHubError,
  onPlayerDisconnected,
  onPlayerJoined,
  onPlayerLeft,
  onPlayRequestAccepted,
  onPlayRequestDenied,
  onPlayRequestReceived,
  onPlayRequestWithdrawn,
  onRoomPlayers,
  onRoundStarted,
  cancelMatchmaking,
  findMatch,
  onMatchmakingCancelled,
  onWaitingForMatch,
  sendChatMessage,
  sendPlayRequest,
  withdrawPlayRequest,
  type ConnectionState,
} from '../signalr-client'
import type { ChatMessage, GameSession, PlayRequest, Player } from '../types'
import { loadRememberedPlayerName, saveRememberedPlayerName } from '../player-name-storage'
import { gameEnded, gameStarted, playerLeft, type RosterBusyState } from '../roster-busy-state'
import './chat-panel'
import './play-requests'
import './challenge-settings'
import './multiplayer-game'
import './multiplayer-results'
import './translation-source-select'
import type { ChallengeSettings } from './challenge-settings'
import type { MultiplayerGameOverDetail } from './multiplayer-results'
import type { TranslationChoice } from './translation-source-select'

type Screen =
  | { step: 'choose' }
  | { step: 'creating' }
  | { step: 'joining' }
  | { step: 'in-room'; roomCode?: string; playerName: string }

/** The player I'm now in a synced game with — set once a PlayRequestAccepted
 * resolves for a request involving me (either as challenger or challenged),
 * cleared once <bg-multiplayer-game> reports the game ended (game-over —
 * the sole event it fires, see that component's own class doc comment for
 * why it deliberately doesn't also react to the opponent's PlayerLeft).
 * Owning just "who" here (not the round/score/timer machinery itself,
 * which <bg-multiplayer-game> owns entirely) keeps this identity fact
 * available for the room-level UI (e.g. hiding the challenge affordance)
 * without duplicating state that already lives in the child. */
interface ActiveGameOpponent {
  id: string
  name: string
}

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

  /** This player's own translation/Bible-file choice — picked BEFORE the
   * name field (see docs/SCRUM/Feature.RequestToStartMPGame.md's
   * per-player-translation note: each player picks their own, and players
   * don't need to match each other). Used both to feed the challenge-type
   * book/chapter selectors when this player challenges someone, and to
   * resolve a multiplayer round's VerseReference to displayable text
   * locally — see <bg-multiplayer-game>. Undefined until
   * <bg-translation-source-select> reports a valid choice; Create/Join/
   * World-chat are disabled until then. */
  @state()
  private myTranslationChoice?: TranslationChoice

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

  /** Ids of players currently in a game — anywhere in the room, not just
   * mine. Tracked purely from RoundStarted/GameOver, both of which are
   * broadcast to the whole room group and carry both player ids, so no
   * extra server payload is needed to know this. Used to show them as
   * busy and refuse to challenge them: the server already rejects such a
   * request (GameHub.fs's SendPlayRequest guard, "That player is already
   * in a game"), but without this the roster still offered them as
   * targets and the only feedback was that error after the fact. */
  @state()
  private busyPlayerIds = new Set<string>()

  /** Ids of the games currently running in this room (any game, not just
   * mine) — the companion to busyPlayerIds, so a game-over can be matched
   * to a game we actually saw start. Without it a late event from an
   * already-finished game would clear its players' busy state while they
   * are mid-way through their NEXT game. */
  @state()
  private activeGameIds = new Set<string>()

  /** Whether this player is queued for a random match. Server-driven: set
   * by WaitingForMatch, cleared by the game starting or by cancelling, so
   * the UI never claims to be waiting when the server disagrees. */
  @state()
  private waitingForMatch = false

  private get _busyState(): RosterBusyState {
    return { activeGameIds: this.activeGameIds, busyPlayerIds: this.busyPlayerIds }
  }

  /** Applies a new busy state, reassigning both fields so Lit re-renders.
   * The decisions themselves live in roster-busy-state.ts. */
  private _applyBusyState(next: RosterBusyState) {
    if (next.activeGameIds !== this.activeGameIds) this.activeGameIds = new Set(next.activeGameIds)
    if (next.busyPlayerIds !== this.busyPlayerIds) this.busyPlayerIds = new Set(next.busyPlayerIds)
  }

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

  /** The game type/round count/time limit I've currently got selected in
   * <bg-challenge-settings> — used to build the play request I send when I
   * click a player's name (see game-type.ts's gameTypeFromRestriction).
   * Defaults match the selector's own defaults. */
  @state()
  private challengeSettings: ChallengeSettings = { scope: 'all', roundCount: 5 }

  /** Set once a play request involving me is accepted — the game screen
   * (<bg-multiplayer-game>) replaces the game-type-select/chat/play-requests
   * block while this is set. See ActiveGameOpponent. */
  @state()
  private activeGameOpponent?: ActiveGameOpponent

  /** The first RoundStarted session for the CURRENT game, captured here —
   * not just left to <bg-multiplayer-game>'s own onRoundStarted
   * subscription — because AcceptPlayRequest's RoundStarted broadcast can
   * arrive before that child component has even mounted (it's created by
   * the very re-render that PlayRequestAccepted, sent moments earlier,
   * triggers) and SignalR's hub.on has no replay/buffering for a listener
   * that subscribes late. This component is already listening for
   * RoundStarted continuously — see the subscription in _enterRoom — so
   * it never misses the message, and hands whatever it most recently saw
   * to <bg-multiplayer-game> as an initial value via its `initialSession`
   * property (see the render below), closing the race structurally
   * instead of relying on subscribe-before-broadcast timing luck.
   * Cleared alongside activeGameOpponent once a game ends. */
  @state()
  private initialSession?: GameSession

  /** Set once <bg-multiplayer-game> reports the game ended normally
   * (game-over) — shows <bg-multiplayer-results> in place of the game
   * screen until the player dismisses it. */
  @state()
  private mpResults?: MultiplayerGameOverDetail

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
  private _unsubscribePlayRequestAccepted?: () => void
  private _unsubscribePlayRequestDenied?: () => void
  private _unsubscribePlayerDisconnected?: () => void
  private _unsubscribePlayerLeft?: () => void
  private _unsubscribeRoundStarted?: () => void
  /** Separate from <bg-multiplayer-game>'s own GameOver subscription —
   * this one is room-wide busy-tracking (see busyPlayerIds), not this
   * player's own game ending. */
  private _unsubscribeGameOverBusy?: () => void
  private _unsubscribeWaitingForMatch?: () => void
  private _unsubscribeMatchmakingCancelled?: () => void

  disconnectedCallback() {
    // This element is torn down wholesale (not via _onLeaveRoom's own
    // button) whenever bg-app.ts's "← Home" button switches away from the
    // 'room-setup' phase — a totally different removal path that used to
    // skip telling the server entirely. Same fix, same reason as
    // _onLeaveRoom: only actually call it if we were ever in a room in
    // the first place (the 'choose' screen never joined anything, so
    // there'd be nothing to leave).
    if (this.screen.step === 'in-room') {
      leaveRoom().catch((err) => {
        console.error('[bg-room-setup] failed to notify the server of leaving the room', err)
      })
    }

    this._unsubscribePlayerJoined?.()
    this._unsubscribeChatMessage?.()
    this._unsubscribeChatHistory?.()
    this._unsubscribeHubError?.()
    this._unsubscribeConnectionState?.()
    this._unsubscribeRoomPlayers?.()
    this._unsubscribePlayRequestReceived?.()
    this._unsubscribePlayRequestWithdrawn?.()
    this._unsubscribePlayRequestAccepted?.()
    this._unsubscribePlayRequestDenied?.()
    this._unsubscribePlayerDisconnected?.()
    this._unsubscribePlayerLeft?.()
    this._unsubscribeRoundStarted?.()
    this._unsubscribeGameOverBusy?.()
    this._unsubscribeWaitingForMatch?.()
    this._unsubscribeMatchmakingCancelled?.()
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
    const canProceed = isBusy ? false : !!this.myTranslationChoice && !!this.playerNameInput.trim()

    return html`
      <div class="setup">
        <h1>Multiplayer</h1>

        ${this.error ? html`<p class="error">${this.error}</p>` : null}

        <div class="translation-block">
          <h2>Your Bible</h2>
          <p class="translation-hint">
            Pick your own translation or upload your own file — other players don't need to match you.
          </p>
          <bg-translation-source-select @translation-changed=${this._onTranslationChanged}></bg-translation-source-select>
        </div>

        <label>
          Your name
          <input
            type="text"
            .value=${this.playerNameInput}
            @input=${(e: Event) => (this.playerNameInput = (e.target as HTMLInputElement).value)}
            placeholder="e.g. Alice"
          />
        </label>

        <button type="button" ?disabled=${!canProceed} @click=${this._onCreateRoom}>
          Create a room
        </button>

        <div class="join">
          <label class="visually-hidden" for="room-code">Room code</label>
          <input
            id="room-code"
            type="text"
            .value=${this.roomCodeInput}
            @input=${(e: Event) => (this.roomCodeInput = (e.target as HTMLInputElement).value)}
            placeholder="Room code"
            maxlength="4"
          />
          <button type="button" ?disabled=${!canProceed || !this.roomCodeInput.trim()} @click=${this._onJoinRoom}>
            Join
          </button>
        </div>

        <button type="button" class="secondary" ?disabled=${!canProceed} @click=${this._onJoinWorldChat}>
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
          ${roomCode
            ? html`
                Room
                <span class="code">${roomCode}</span>
              `
            : 'World chat'}
        </h1>

        ${isDisconnected
          ? html`
              <p class="error">
                Lost connection to the server — trying to reconnect…
              </p>
            `
          : null}
        ${this.error
          ? html`
              <p class="error">${this.error}</p>
            `
          : null}

        ${this.mpResults
          ? html`<bg-multiplayer-results .result=${this.mpResults} @back-to-room=${this._onBackToRoomFromResults}></bg-multiplayer-results>`
          : this.activeGameOpponent
            ? html`<bg-multiplayer-game
                .myPlayerId=${this.myPlayerId}
                .myPlayerName=${this.playerNameInput.trim()}
                .opponentId=${this.activeGameOpponent.id}
                .opponentName=${this.activeGameOpponent.name}
                .translation=${this.myTranslationChoice?.translation}
                .verseSource=${this.myTranslationChoice?.verseSource}
                .initialSession=${this.initialSession}
                @game-over=${this._onMultiplayerGameOver}
              ></bg-multiplayer-game>`
            : html`
                <bg-challenge-settings
                  .verseSource=${this.myTranslationChoice?.verseSource}
                  .translation=${this.myTranslationChoice?.translation}
                  @challenge-settings-changed=${this._onChallengeSettingsChanged}
                ></bg-challenge-settings>

                ${this._renderMatchmaking()}

                <bg-chat-panel
                  .players=${this.players}
                  .messages=${this.messages}
                  .myPlayerId=${this.myPlayerId}
                  .connectionState=${this.connectionState}
                  .disconnectedPlayerIds=${this.disconnectedPlayerIds}
                  .busyPlayerIds=${this.busyPlayerIds}
                  @chat-submit=${this._onChatSubmit}
                  @player-selected=${this._onPlayerSelected}
                ></bg-chat-panel>

                <bg-play-requests
                  .requests=${this.playRequests}
                  .sentRequestToName=${this._sentRequestToName()}
                  .verseSource=${this.myTranslationChoice?.verseSource}
                  .translation=${this.myTranslationChoice?.translation}
                  @withdraw-play-request=${this._onWithdrawPlayRequest}
                  @accept-play-request=${this._onAcceptPlayRequest}
                  @deny-play-request=${this._onDenyPlayRequest}
                ></bg-play-requests>
              `}

        <button type="button" class="secondary" @click=${this._onLeaveRoom}>
          Back to chat selection
        </button>
      </div>
    `;
  }

  private async _onCreateRoom() {
    this.error = undefined
    this.screen = { step: 'creating' }
    const playerName = this.playerNameInput.trim()
    try {
      const room = await api.createRoom()
      await this._enterRoom(room.code, playerName, () => joinRoom(room.code, playerName))
    } catch (err) {
      // A rejected hub invoke is a generic "An unexpected error occurred
      // invoking '...' on the server." (SignalR hides the real failwith
      // message by design) — the ACTUAL reason arrives just beforehand as
      // a server-pushed "Error" event (see onHubError, subscribed inside
      // _enterRoom before the invoke resolves/rejects), which already
      // landed in this.error. Prefer that over the generic message rather
      // than clobbering it.
      this.error ?? (this.error = err instanceof Error ? err.message : 'Failed to create a room.')
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
      // See _onCreateRoom's comment — prefer the server-pushed Error
      // message (already in this.error via onHubError) over SignalR's
      // generic invoke-rejection message.
      this.error ?? (this.error = err instanceof Error ? err.message : 'Failed to join the room.')
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
      // See _onCreateRoom's comment — prefer the server-pushed Error
      // message (already in this.error via onHubError) over SignalR's
      // generic invoke-rejection message.
      this.error ?? (this.error = err instanceof Error ? err.message : 'Failed to join World chat.')
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
    this._unsubscribePlayRequestAccepted = onPlayRequestAccepted((fromPlayerId, toPlayerId) => {
      this._resolvePlayRequest(fromPlayerId, toPlayerId)

      // A game only starts for the two players actually involved — every
      // other client in the room also sees this broadcast (see
      // GameHub.fs's targeting doc comment) but has no stake in it.
      // initialSession is reset here (not just left over from a previous
      // game) so a stale earlier session can never leak into this new
      // one — see onRoundStarted below for why it's captured here at
      // all.
      if (fromPlayerId === this.myPlayerId) {
        const opponent = this.players.find((p) => p.id === toPlayerId)
        if (opponent) {
          this.activeGameOpponent = { id: opponent.id, name: opponent.name }
          this.initialSession = undefined
        }
      } else if (toPlayerId === this.myPlayerId) {
        const opponent = this.players.find((p) => p.id === fromPlayerId)
        if (opponent) {
          this.activeGameOpponent = { id: opponent.id, name: opponent.name }
          this.initialSession = undefined
        }
      }
    })
    // Captured here — not left solely to <bg-multiplayer-game>'s own
    // onRoundStarted subscription — because AcceptPlayRequest's
    // RoundStarted broadcast (sent moments after PlayRequestAccepted,
    // just above) can arrive before that child component even exists:
    // it's created by the very re-render PlayRequestAccepted just
    // triggered (see _renderRoom's activeGameOpponent branch), and
    // SignalR's hub.on has no replay for a listener that subscribes
    // late. This component has been listening continuously since before
    // any of this happened, so it can't miss the message — whatever it
    // last saw for MY current game is handed to <bg-multiplayer-game> as
    // its `initialSession` property (see the render below), which reads
    // it once on mount rather than waiting on its own subscription to
    // win a timing race. Every event this component doesn't own the
    // player-filtering logic for (is this session actually MY game?) is
    // filtered the same way <bg-multiplayer-game> filters its own
    // RoundStarted/RoundScored/GameOver — by checking both playerA/
    // playerB against myPlayerId + the just-set opponent id — since this
    // room can have other concurrent games (e.g. World chat) broadcasting
    // the same event.
    this._unsubscribeRoundStarted = onRoundStarted((session) => {
      // Busy-tracking first, and deliberately BEFORE the "is this my
      // game?" guard below — every game in the room marks its two
      // players busy for everyone else's roster, not just mine.
      this._applyBusyState(gameStarted(this._busyState, session.gameId, session.playerA, session.playerB))

      // Being in the game that just started is what ends the wait — the
      // server never sends a separate "matched" event, since RoundStarted
      // already says everything the client needs.
      if (session.playerA === this.myPlayerId || session.playerB === this.myPlayerId) {
        this.waitingForMatch = false

        // A matched game has no play request behind it, so nothing else
        // will set the opponent — and without it the game screen never
        // mounts. Resolved from the session itself, which is the only
        // place a matched player learns who they were paired with.
        if (!this.activeGameOpponent) {
          const opponentId = session.playerA === this.myPlayerId ? session.playerB : session.playerA
          const opponent = this.players.find((p) => p.id === opponentId)
          this.activeGameOpponent = { id: opponentId, name: opponent?.name ?? 'Your opponent' }
          this.initialSession = session
        }
      }

      const opponentId = this.activeGameOpponent?.id
      if (!opponentId) return
      const pair = new Set([session.playerA, session.playerB])
      if (pair.has(this.myPlayerId) && pair.has(opponentId)) this.initialSession = session
    })
    this._unsubscribeWaitingForMatch = onWaitingForMatch(() => {
      this.waitingForMatch = true
    })
    this._unsubscribeMatchmakingCancelled = onMatchmakingCancelled(() => {
      this.waitingForMatch = false
    })
    this._unsubscribeGameOverBusy = onGameOver((gameId, _scores, playerA, playerB) => {
      // Matched by game id, not merely by the player pair — see
      // roster-busy-state.ts, where that rule lives and is tested.
      this._applyBusyState(gameEnded(this._busyState, gameId, playerA, playerB))
    })
    this._unsubscribePlayRequestDenied = onPlayRequestDenied((fromPlayerId, toPlayerId) => {
      this._resolvePlayRequest(fromPlayerId, toPlayerId)
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
      this._applyBusyState(playerLeft(this._busyState, playerId))
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

  /** Common handling for a play request being resolved (accepted or
   * denied) anywhere in the room — drop it from whichever local list it's
   * tracked in, on either side of the exchange. */
  private _resolvePlayRequest(fromPlayerId: string, _toPlayerId: string) {
    this.playRequests = this.playRequests.filter((r) => r.fromPlayerId !== fromPlayerId)
    if (fromPlayerId === this.myPlayerId) {
      this.sentRequestToId = undefined
    }
  }

  private _onChatSubmit(event: CustomEvent<string>) {
    sendChatMessage(event.detail).catch((err) => {
      console.error('[bg-room-setup] failed to send chat message', err)
    })
  }

  private _onPlayerSelected(event: CustomEvent<string>) {
    const targetId = event.detail
    // Defense in depth — chat-panel.ts already never attaches a click
    // handler to an Offline row, so this normally can't fire for a
    // disconnected player; this guards the narrow race where a click
    // lands a frame before a PlayerDisconnected re-render removes the
    // handler (see docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md).
    if (this.disconnectedPlayerIds.has(targetId)) return
    // Same defense in depth for a player already in a game — the server
    // rejects it anyway (GameHub.fs's SendPlayRequest guard), but there's
    // no reason to send a request that can only come back as an error.
    if (this.busyPlayerIds.has(targetId)) return

    const { scope, restriction, roundCount, timeLimitSeconds } = this.challengeSettings
    const verseSource = this.myTranslationChoice?.verseSource
    if (!verseSource) return

    gameTypeFromRestriction(scope, verseSource, this.myTranslationChoice?.translation, restriction)
      .then((gameType) => sendPlayRequest(targetId, gameType, roundCount, timeLimitSeconds))
      .catch((err) => {
        console.error('[bg-room-setup] failed to send play request', err)
      })
  }

  private _onWithdrawPlayRequest() {
    withdrawPlayRequest().catch((err) => {
      console.error('[bg-room-setup] failed to withdraw play request', err)
    })
  }

  /** "Play someone random" — see
   * docs/SCRUM/DONE/Feature.StartMulitplayerGameWaitForRandomPlayer.md and
   * Feature.ConnectToRandomNextOpenGame.md, the two halves of one queue.
   * The button both joins the queue and takes an open slot: which happens
   * depends on who is already waiting, which only the server can know. */
  private _renderMatchmaking() {
    if (this.waitingForMatch) {
      return html`
        <div class="matchmaking">
          <p role="status">Waiting for another player to join…</p>
          <p class="matchmaking-hint">
            The game will use your settings above — whoever joins you plays the game you chose.
          </p>
          <button type="button" class="secondary" @click=${this._onCancelMatchmaking}>Stop waiting</button>
        </div>
      `
    }

    return html`
      <div class="matchmaking">
        <button type="button" @click=${this._onFindMatch}>Play someone random</button>
        <!-- States the policy where the choice is actually made. Burying
             it in developer docs left the joining player silently playing
             a game they did not pick — see
             docs/SCRUM/BUGS/Bug.PlaySomeoneRandom.md. -->
        <p class="matchmaking-hint">
          If someone is already waiting, you'll join their game and play with
          <strong>their settings</strong>. Otherwise you'll wait, and the next player joins
          <strong>your settings</strong> above.
        </p>
      </div>
    `
  }

  private _onFindMatch() {
    const { scope, restriction, roundCount, timeLimitSeconds } = this.challengeSettings
    const verseSource = this.myTranslationChoice?.verseSource
    if (!verseSource) return

    gameTypeFromRestriction(scope, verseSource, this.myTranslationChoice?.translation, restriction)
      .then((gameType) => findMatch(gameType, roundCount, timeLimitSeconds))
      .catch((err) => {
        console.error('[bg-room-setup] failed to look for a match', err)
      })
  }

  private _onCancelMatchmaking() {
    cancelMatchmaking().catch((err) => {
      console.error('[bg-room-setup] failed to stop waiting for a match', err)
    })
  }

  private _onChallengeSettingsChanged(event: CustomEvent<ChallengeSettings>) {
    this.challengeSettings = event.detail
  }

  private _onTranslationChanged(event: CustomEvent<TranslationChoice | undefined>) {
    this.myTranslationChoice = event.detail
  }

  private _onAcceptPlayRequest(event: CustomEvent<string>) {
    acceptPlayRequest(event.detail).catch((err) => {
      console.error('[bg-room-setup] failed to accept play request', err)
    })
  }

  private _onDenyPlayRequest(event: CustomEvent<string>) {
    denyPlayRequest(event.detail).catch((err) => {
      console.error('[bg-room-setup] failed to deny play request', err)
    })
  }

  // The game ended normally (or by forfeit) — the server-authoritative
  // GameOver reached <bg-multiplayer-game>, which built the results detail
  // for us. Show the results screen; the game screen itself unmounts since
  // activeGameOpponent clears too (see _renderRoom's branching).
  private _onMultiplayerGameOver(event: CustomEvent<MultiplayerGameOverDetail>) {
    this.mpResults = event.detail
    this.activeGameOpponent = undefined
    this.initialSession = undefined
  }

  private _onBackToRoomFromResults() {
    this.mpResults = undefined
  }

  private _sentRequestToName(): string | undefined {
    if (!this.sentRequestToId) return undefined
    return this.players.find((p) => p.id === this.sentRequestToId)?.name
  }

  // Leaves the current room/World chat back to the create-or-join screen.
  // The underlying hub connection stays up (it's a shared singleton the
  // app may reuse elsewhere) — only leaveRoom() itself tells the server
  // this player is gone (see its own doc comment for why that matters:
  // without it, this player's name stayed unusable in this exact room
  // for as long as the tab stayed open). Fire-and-forget, same as this
  // file's other best-effort hub calls (e.g. sendChatMessage) — the local
  // teardown below happens regardless of whether it succeeds, since the
  // player is leaving either way.
  private _onLeaveRoom() {
    leaveRoom().catch((err) => {
      console.error('[bg-room-setup] failed to notify the server of leaving the room', err)
    })

    this._unsubscribePlayerJoined?.()
    this._unsubscribeChatMessage?.()
    this._unsubscribeChatHistory?.()
    this._unsubscribeHubError?.()
    this._unsubscribeConnectionState?.()
    this._unsubscribeRoomPlayers?.()
    this._unsubscribePlayRequestReceived?.()
    this._unsubscribePlayRequestWithdrawn?.()
    this._unsubscribePlayRequestAccepted?.()
    this._unsubscribePlayRequestDenied?.()
    this._unsubscribePlayerDisconnected?.()
    this._unsubscribePlayerLeft?.()
    this._unsubscribeRoundStarted?.()
    this._unsubscribeGameOverBusy?.()
    this._unsubscribeWaitingForMatch?.()
    this._unsubscribeMatchmakingCancelled?.()

    this.players = []
    this.messages = []
    this.myPlayerId = ''
    this.playRequests = []
    this.sentRequestToId = undefined
    this.challengeSettings = { scope: 'all', roundCount: 5 }
    this.activeGameOpponent = undefined
    this.initialSession = undefined
    this.mpResults = undefined
    this.disconnectedPlayerIds = new Set()
    this.busyPlayerIds = new Set()
    this.activeGameIds = new Set()
    this.waitingForMatch = false
    this.error = undefined
    this.connectionState = 'connected'
    this.screen = { step: 'choose' }
  }

  static styles = css`
    .matchmaking {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      align-items: flex-start;
    }

    .matchmaking-hint {
      margin: 0;
      font-size: 0.85rem;
      opacity: 0.75;
    }

    /* See chat-panel.ts for why a placeholder can't serve as a label. */
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
    }

    .setup,
    .room {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .translation-block {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .translation-block h2 {
      font-size: 0.9rem;
      margin: 0;
    }

    .translation-hint {
      margin: 0;
      font-size: 0.8rem;
      opacity: 0.7;
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
      color: var(--accent);
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
      background: var(--accent);
      color: var(--accent-text);
      font-size: 1rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
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
