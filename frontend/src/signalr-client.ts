import * as signalR from '@microsoft/signalr'
import { api } from './api'
import type { ChatMessage } from './types'

// Event names must match backend/Api/GameHub.fs's *Event literals.
export const HubEvents = {
  PlayerJoined: 'PlayerJoined',
  RoundStarted: 'RoundStarted',
  RoundScored: 'RoundScored',
  ChatMessageReceived: 'ChatMessageReceived',
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
      .withUrl(`${api.baseUrl}/hubs/game`)
      .withAutomaticReconnect()
      .build()

    connectionPromise = connection.start().then(() => connection)
  }

  return connectionPromise
}

export async function joinRoom(roomCode: string, playerName: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('JoinRoom', roomCode, playerName)
}

/** Joins the always-open World chat room — just a name, no room code. */
export async function joinWorldChat(playerName: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('JoinWorldChat', playerName)
}

export async function sendChatMessage(text: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('SendChatMessage', text)
}

/** Subscribes to chat messages arriving in whatever room the caller has
 * joined. Returns an unsubscribe function. */
export function onChatMessage(handler: (message: ChatMessage) => void): () => void {
  let cancelled = false
  const listener = (message: ChatMessage) => {
    if (!cancelled) handler(message)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.ChatMessageReceived, listener))

  return () => {
    cancelled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.ChatMessageReceived, listener))
  }
}

/** Subscribes to PlayerJoined events. Returns an unsubscribe function. */
export function onPlayerJoined(handler: (playerName: string) => void): () => void {
  let cancelled = false
  const listener = (playerName: string) => {
    if (!cancelled) handler(playerName)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.PlayerJoined, listener))

  return () => {
    cancelled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.PlayerJoined, listener))
  }
}

/** Subscribes to server-pushed error messages. Returns an unsubscribe function. */
export function onHubError(handler: (message: string) => void): () => void {
  let cancelled = false
  const listener = (message: string) => {
    if (!cancelled) handler(message)
  }

  void getGameHubConnection().then((hub) => hub.on(HubEvents.Error, listener))

  return () => {
    cancelled = true
    void getGameHubConnection().then((hub) => hub.off(HubEvents.Error, listener))
  }
}
