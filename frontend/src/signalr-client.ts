import * as signalR from '@microsoft/signalr'
import { api } from './api'
import type {
  ChatMessage,
  GameOverReason,
  GameSession,
  GameType,
  Guess,
  LeaderboardSnapshot,
  PlayRequest,
  Player,
  RoomActivityView,
} from './types'

// Event names must match backend/Api/GameHub.fs's *Event literals.
export const HubEvents = {
  PlayerJoined: 'PlayerJoined',
  RoundStarted: 'RoundStarted',
  RoundScored: 'RoundScored',
  GameOver: 'GameOver',
  ChatMessageReceived: 'ChatMessageReceived',
  ChatHistory: 'ChatHistory',
  RoomPlayers: 'RoomPlayers',
  WaitingForMatch: 'WaitingForMatch',
  MatchmakingCancelled: 'MatchmakingCancelled',
  PlayRequestReceived: 'PlayRequestReceived',
  PlayRequestWithdrawn: 'PlayRequestWithdrawn',
  PlayRequestAccepted: 'PlayRequestAccepted',
  PlayRequestDenied: 'PlayRequestDenied',
  PlayerLeft: 'PlayerLeft',
  PlayerDisconnected: 'PlayerDisconnected',
  RoomActivityChanged: 'RoomActivityChanged',
  LeaderboardUpdated: 'LeaderboardUpdated',
  Error: 'Error',
} as const

// Cache the in-flight START PROMISE, not just the connection object — the
// object exists (and is truthy) the instant HubConnectionBuilder().build()
// returns, well before .start() resolves. Several call sites here
// (onPlayerJoined/onChatMessage/onHubError/joinRoom, etc.) all call
// getGameHubConnection() synchronously back-to-back on the same tick (e.g.
// bg-room-setup.ts's _enterRoom), so caching only the object let a second
// caller grab a connection that was still mid-handshake and invoke on it
// before .start() finished — SignalR then throws "Cannot send data if the
// connection is not in the 'Connected' State." Caching the promise instead
// means every caller awaits the SAME in-flight start, however many arrive
// before it resolves.
let connectionPromise: Promise<signalR.HubConnection> | undefined

/** Lazily creates and starts the shared hub connection. Safe to call
 * multiple times concurrently — every caller awaits the same start. */
export function getGameHubConnection(): Promise<signalR.HubConnection> {
  if (!connectionPromise) {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${api.baseUrl}/hubs/game`, {
        // WebSockets only, deliberately — no fallback to ServerSentEvents
        // or LongPolling. WebSockets has been supported in every browser
        // that matters since ~2012 (a browser too old for it has other
        // problems too), so requiring it outright is a reasonable modern
        // baseline, not a compatibility risk. Forcing a single transport
        // also lets skipNegotiation:true bypass the separate HTTP
        // "negotiate" round-trip entirely (only legal when the transport
        // is pinned like this) and go straight to the WebSocket handshake
        // — one less HTTP request that could itself get stuck behind a
        // proxy (this is what fixed local dev hanging behind a devcontainer
        // port-forward).
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true,
      })
      .withAutomaticReconnect()
      .build()

    connectionPromise = connection.start().then(() => connection)
  }

  return connectionPromise
}

/** Whether the hub connection is currently up. `signalR`'s own
 * `withAutomaticReconnect()` handles retrying — this just reports the
 * current state so the UI can show it (e.g. cross out the chat panel while
 * disconnected/reconnecting). */
/** The realtime connection's state as SignalR reports it.
 *
 * `reconnecting` is deliberately distinct from `disconnected`: they mean
 * different things to a player — one is "hold on", the other is "this is
 * not working" — and collapsing them made the UI unable to say which
 * (see docs/SCRUM/DONE/Bug.CantTrustConnectionStatusIconRightUpperCorner.md).
 * Existing consumers that only care about "is it usable" can treat
 * anything other than 'connected' as not usable. */
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'

/** Subscribes to connection up/down changes. Fires immediately with the
 * connection's current state, then again on every state change. Returns an
 * unsubscribe function.
 *
 * Note: HubConnection.onclose/onreconnecting/onreconnected each push onto
 * an internal callback list (there's no matching `off`), so an
 * "unsubscribe" here can only stop this handler from firing — it can't
 * remove the underlying hook from the connection. That's fine in practice:
 * the connection is a shared singleton for the app's lifetime, so the
 * handful of hooks registered by however many components have subscribed
 * over time just sit there harmlessly once canceled. */
export function onConnectionStateChange(handler: (state: ConnectionState) => void): () => void {
  let canceled = false

  void getGameHubConnection().then((hub) => {
    if (canceled) return

    // Report the state as of right now — the connection may already be up
    // by the time a caller subscribes (getGameHubConnection only resolves
    // once .start() has succeeded), and onclose/onreconnecting only fire on
    // a LATER transition, not for "already connected".
    handler('connected')

    hub.onclose(() => {
      if (!canceled) handler('disconnected')
    })
    hub.onreconnecting(() => {
      if (!canceled) handler('reconnecting')
    })
    hub.onreconnected(() => {
      if (!canceled) handler('connected')
    })
  })

  return () => {
    canceled = true
  }
}

/** Joins a room by code. Resolves with the caller's own newly-created
 * Player (stable id + name) — needed client-side to know which
 * players-list entry is "me". */
export async function joinRoom(roomCode: string, playerName: string): Promise<Player> {
  const hub = await getGameHubConnection()
  return await hub.invoke<Player>('JoinRoom', roomCode, playerName)
}

/** Joins the always-open World chat room — just a name, no room code.
 * Resolves with the caller's own newly-created Player. */
export async function joinWorldChat(playerName: string): Promise<Player> {
  const hub = await getGameHubConnection()
  return await hub.invoke<Player>('JoinWorldChat', playerName)
}

export async function sendChatMessage(text: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('SendChatMessage', text)
}

/** Subscribes to chat messages arriving in whatever room the caller has
 * joined. Returns an unsubscribe function. */
export function onChatMessage(handler: (message: ChatMessage) => void): () => void {
  let canceled = false
  const listener = (message: ChatMessage) => {
    if (!canceled) handler(message)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.ChatMessageReceived, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.ChatMessageReceived, listener))
  }
}

/** Subscribes to the one-time chat history sent right after joining a room
 * — the room's recent messages (oldest first), so a new joiner sees
 * context instead of a blank chat. Returns an unsubscribe function. */
export function onChatHistory(handler: (messages: ChatMessage[]) => void): () => void {
  let canceled = false
  const listener = (messages: ChatMessage[]) => {
    if (!canceled) handler(messages)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.ChatHistory, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.ChatHistory, listener))
  }
}

/** Subscribes to PlayerJoined events. Returns an unsubscribe function. */
export function onPlayerJoined(handler: (player: Player) => void): () => void {
  let canceled = false
  const listener = (player: Player) => {
    if (!canceled) handler(player)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayerJoined, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayerJoined, listener))
  }
}

/** Subscribes to the one-time roster snapshot sent right after joining a
 * room — everyone currently in the room, including yourself. This is a full
 * snapshot, not a delta: replace your local players list wholesale on
 * receipt rather than appending. Returns an unsubscribe function. */
export function onRoomPlayers(handler: (players: Player[]) => void): () => void {
  let canceled = false
  const listener = (players: Player[]) => {
    if (!canceled) handler(players)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.RoomPlayers, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.RoomPlayers, listener))
  }
}

/** Sends (or retargets) a play request to `toPlayerId`, for the
 * `gameType`/`roundCount`/`timeLimitSeconds` chosen beforehand — see
 * game-types/registry.ts. `timeLimitSeconds` undefined (or 0) means no limit; the
 * hub translates that into backend/Domain/Scoring.fs's TimeLimit, so this
 * never needs to construct a {Case:'Unlimited'}-shaped value by hand. */
export async function sendPlayRequest(
  toPlayerId: string,
  gameType: GameType,
  roundCount: number,
  timeLimitSeconds?: number,
): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('SendPlayRequest', toPlayerId, gameType, roundCount, timeLimitSeconds ?? null)
}

/** Withdraws whatever play request the caller currently has pending, if any. */
export async function withdrawPlayRequest(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('WithdrawPlayRequest')
}

/** Accepts the pending request from `fromPlayerId` addressed to the caller
 * — starts the GameSession it described; see onRoundStarted. */
export async function acceptPlayRequest(fromPlayerId: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('AcceptPlayRequest', fromPlayerId)
}

/** Denies the pending request from `fromPlayerId` addressed to the caller. */
export async function denyPlayRequest(fromPlayerId: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('DenyPlayRequest', fromPlayerId)
}

/** Submits the caller's guess for the current round of their active game.
 * `guess.bookNumber` (the guessed book's number in the CALLER'S OWN
 * VerseSource — see shared-kernel/book-numbers.ts's bookNumberOfGuess) is what lets the
 * server score by number instead of name; undefined falls back to name
 * matching server-side. The server determines correctness/points and
 * broadcasts RoundScored once everyone has guessed or the round's
 * time limit elapses — this call's own resolution carries no result. */
export async function submitGuess(guess: Guess): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('SubmitGuess', guess.book, guess.bookNumber, guess.chapter, guess.verseNumber)
}

/** Gives up the caller's active game, if they have one. A duel ends and
 * the opponent is notified via GameOver(Forfeited); leaving a Congregation
 * only takes the caller out of it while the others play on. */
export async function forfeitGame(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('ForfeitGame')
}

/** Tells the server the caller is voluntarily leaving their current room
 * — call this before tearing down the room-setup UI (going Home, "Back to
 * chat selection"), not just resetting local state. Without it, the
 * caller's Player stays fully "connected" server-side for as long as this
 * page/tab stays open (the hub connection is a page-lifetime singleton —
 * see getGameHubConnection — never stopped on navigation), which used to
 * make rejoining the SAME room under the SAME name fail with "already
 * taken" even though nothing was actually still using it. A no-op if the
 * caller isn't currently in a room. Deliberately doesn't stop the
 * underlying connection — the same connection may go on to join a
 * different room right after. */
export async function leaveRoom(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('LeaveRoom')
}

/** Subscribes to play requests sent/retargeted anywhere in the caller's
 * room — filter to `request.toPlayerId`/`request.fromPlayerId` matching
 * your own id, same pattern as filtering ChatMessageReceived by room
 * membership. Returns an unsubscribe function. */
export function onPlayRequestReceived(handler: (request: PlayRequest) => void): () => void {
  let canceled = false
  const listener = (request: PlayRequest) => {
    if (!canceled) handler(request)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayRequestReceived, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayRequestReceived, listener))
  }
}

/** Subscribes to play-request withdrawals — payload is the withdrawing
 * sender's player id. Returns an unsubscribe function. */
export function onPlayRequestWithdrawn(handler: (fromPlayerId: string) => void): () => void {
  let canceled = false
  const listener = (fromPlayerId: string) => {
    if (!canceled) handler(fromPlayerId)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayRequestWithdrawn, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayRequestWithdrawn, listener))
  }
}

/** Subscribes to a play request being accepted anywhere in the caller's
 * room — payload is (fromPlayerId, toPlayerId) identifying which request,
 * same as onPlayRequestDenied. Filter to whichever side of the pair
 * matters to you, same pattern as filtering ChatMessageReceived by room
 * membership. Returns an unsubscribe function. */
export function onPlayRequestAccepted(handler: (fromPlayerId: string, toPlayerId: string) => void): () => void {
  let canceled = false
  const listener = (fromPlayerId: string, toPlayerId: string) => {
    if (!canceled) handler(fromPlayerId, toPlayerId)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayRequestAccepted, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayRequestAccepted, listener))
  }
}

/** Subscribes to a play request being denied — same payload shape as
 * onPlayRequestAccepted. Returns an unsubscribe function. */
export function onPlayRequestDenied(handler: (fromPlayerId: string, toPlayerId: string) => void): () => void {
  let canceled = false
  const listener = (fromPlayerId: string, toPlayerId: string) => {
    if (!canceled) handler(fromPlayerId, toPlayerId)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayRequestDenied, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayRequestDenied, listener))
  }
}

/** Subscribes to a multiplayer round starting — the first (roundIndex: 0,
 * right after AcceptPlayRequest succeeds) or any subsequent one (after the
 * previous round resolved). Payload is the full GameSession — see
 * types.ts's GameSession doc comment for why this is a full snapshot
 * rather than a delta. Returns an unsubscribe function. */
export function onRoundStarted(handler: (session: GameSession) => void): () => void {
  let canceled = false
  const listener = (session: GameSession) => {
    if (!canceled) handler(session)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.RoundStarted, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.RoundStarted, listener))
  }
}

/** Subscribes to a multiplayer round resolving (both players guessed, or
 * the time limit elapsed) — payload is the full GameSession, with `round`
 * now the Scored case. Returns an unsubscribe function. */
export function onRoundScored(handler: (session: GameSession) => void): () => void {
  let canceled = false
  const listener = (session: GameSession) => {
    if (!canceled) handler(session)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.RoundScored, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.RoundScored, listener))
  }
}

/** Subscribes to a multiplayer game ending — either the final round
 * completed normally, a duel player forfeited (left/disconnected past the
 * grace period, or explicitly forfeited), or every Congregation
 * participant left. Payload is (gameId, scores, participants, reason) —
 * scores is a full running total per player id, same as GameSession's,
 * not a delta.
 *
 * `gameId` identifies WHICH game ended. Handlers must match on it and
 * ignore anything that isn't the game they're currently playing: the
 * player pair alone doesn't identify a game, so without this a finished
 * game's event tears down the same pair's NEXT game mid-round (see
 * docs/SCRUM/BUGS/BUG.StaleGameOverEndsTheWrongGame.md).
 *
 * Returns an unsubscribe function. */
export function onGameOver(
  handler: (
    gameId: string,
    scores: Record<string, number>,
    participants: string[],
    reason: GameOverReason,
  ) => void,
): () => void {
  let canceled = false
  const listener = (
    gameId: string,
    scores: Record<string, number>,
    participants: string[],
    reason: GameOverReason,
  ) => {
    if (!canceled) handler(gameId, scores, participants, reason)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.GameOver, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.GameOver, listener))
  }
}

/** Subscribes to a player's connection dropping (tab closed, network
 * hiccup, refresh) — payload is their player id. They stay in the room
 * (still visible/targetable) for a grace period, so use this only to show
 * a "disconnected" indicator, not to remove them from any local list —
 * see onPlayerLeft for the actual removal, once the server-side grace
 * period elapses. Returns an unsubscribe function. */
export function onPlayerDisconnected(handler: (playerId: string) => void): () => void {
  let canceled = false
  const listener = (playerId: string) => {
    if (!canceled) handler(playerId)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayerDisconnected, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayerDisconnected, listener))
  }
}

/** Subscribes to a player being removed from the room after being
 * disconnected for longer than the server's grace period — payload is
 * their player id. Returns an unsubscribe function. */
export function onPlayerLeft(handler: (playerId: string) => void): () => void {
  let canceled = false
  const listener = (playerId: string) => {
    if (!canceled) handler(playerId)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayerLeft, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayerLeft, listener))
  }
}

/** Subscribes to server-pushed error messages. Returns an unsubscribe function. */
export function onHubError(handler: (message: string) => void): () => void {
  let canceled = false
  const listener = (message: string) => {
    if (!canceled) handler(message)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.Error, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.Error, listener))
  }
}

/** Asks to be matched with any other waiting player — see
 * docs/SCRUM/DONE/Feature.StartMulitplayerGameWaitForRandomPlayer.md. If
 * someone is already waiting a game starts at once (arriving as the usual
 * RoundStarted); otherwise the caller is queued and gets WaitingForMatch. */
export async function findMatch(
  gameType: GameType,
  roundCount: number,
  timeLimitSeconds?: number,
): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('FindMatch', gameType, roundCount, timeLimitSeconds ?? null)
}

/** Stops waiting to be matched. Safe to call when not waiting. */
export async function cancelMatchmaking(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('CancelMatchmaking')
}

/** Subscribes to being queued for a match. Returns an unsubscribe function. */
export function onWaitingForMatch(handler: () => void): () => void {
  let canceled = false
  const listener = () => {
    if (!canceled) handler()
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.WaitingForMatch, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.WaitingForMatch, listener))
  }
}

/** Subscribes to matchmaking being canceled. Returns an unsubscribe function. */
export function onMatchmakingCancelled(handler: () => void): () => void {
  let canceled = false
  const listener = () => {
    if (!canceled) handler()
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.MatchmakingCancelled, listener))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.MatchmakingCancelled, listener))
  }
}

/** Subscribes to `event` with a handler taking the event's arguments.
 * Returns an unsubscribe function — the same contract as every on*
 * function above. */
function subscribe<Args extends unknown[]>(event: string, handler: (...args: Args) => void): () => void {
  let canceled = false
  const listener = (...args: Args) => {
    if (!canceled) handler(...args)
  }

  void getGameHubConnection().then((hub) => hub.on(event, listener as (...args: unknown[]) => void))

  return () => {
    canceled = true
    void getGameHubConnection().then((hub) => hub.off(event, listener as (...args: unknown[]) => void))
  }
}

/** Subscribes to the connection coming back after an automatic reconnect.
 * SignalR forgets every group membership on reconnect, so anything that
 * joined a group (see watchRoom) must join it again from here. */
export function onReconnected(handler: () => void): () => void {
  let canceled = false

  void getGameHubConnection().then((hub) =>
    hub.onreconnected(() => {
      if (!canceled) handler()
    }),
  )

  return () => {
    canceled = true
  }
}

/** Subscribes to what the room is doing — duels, an open Congregation
 * lobby, or a running Congregation. Sent on every change and once right
 * after joining. */
export function onRoomActivityChanged(handler: (activity: RoomActivityView) => void): () => void {
  return subscribe(HubEvents.RoomActivityChanged, handler)
}

/** Subscribes to the room's Congregation leaderboard — sent to players and
 * spectators alike whenever it changes. */
export function onLeaderboardUpdated(handler: (board: LeaderboardSnapshot) => void): () => void {
  return subscribe(HubEvents.LeaderboardUpdated, handler)
}

/** Opens a Congregation lobby in the caller's room with the caller as
 * host — see docs/web/congregation. A Congregation always has a time
 * limit. */
export async function openCongregation(gameType: GameType, roundCount: number, timeLimitSeconds: number): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('OpenCongregation', gameType, roundCount, timeLimitSeconds)
}

export async function joinCongregation(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('JoinCongregation')
}

/** Leaves the open lobby. The host leaving cancels it. */
export async function leaveCongregation(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('LeaveCongregation')
}

/** The host cancels their lobby without starting it. */
export async function cancelCongregation(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('CancelCongregation')
}

/** The host starts the lobby's game with the members connected now. */
export async function startCongregation(): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('StartCongregation')
}

/** Opens the read-only spectator board for `roomCode` — no name, no join.
 * Resolves with the current board; LeaderboardUpdated follows on every
 * change. Must be called again after a reconnect (see onReconnected). */
export async function watchRoom(roomCode: string): Promise<LeaderboardSnapshot> {
  const hub = await getGameHubConnection()
  return await hub.invoke<LeaderboardSnapshot>('WatchRoom', roomCode)
}

export async function unwatchRoom(roomCode: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('UnwatchRoom', roomCode)
}
