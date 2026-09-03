import * as signalR from '@microsoft/signalr'
import { api } from './api'

// Event names must match backend/Api/GameHub.fs's *Event literals.
export const HubEvents = {
  PlayerJoined: 'PlayerJoined',
  RoundStarted: 'RoundStarted',
  RoundScored: 'RoundScored',
  Error: 'Error',
} as const

let connection: signalR.HubConnection | undefined

/** Lazily creates and starts the shared hub connection. */
export async function getGameHubConnection(): Promise<signalR.HubConnection> {
  if (connection) {
    return connection
  }

  connection = new signalR.HubConnectionBuilder()
    .withUrl(`${api.baseUrl}/hubs/game`)
    .withAutomaticReconnect()
    .build()

  await connection.start()
  return connection
}

export async function joinRoom(roomCode: string, playerName: string): Promise<void> {
  const hub = await getGameHubConnection()
  await hub.invoke('JoinRoom', roomCode, playerName)
}
