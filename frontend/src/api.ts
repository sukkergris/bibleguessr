import type { Room, Verse } from './types'

// Configure via a Vite env var (frontend/.env.local) if the backend isn't
// running on the default dev port, e.g. VITE_API_BASE_URL=http://localhost:5080
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5080'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  baseUrl: API_BASE_URL,
  getRandomVerse: () => getJson<Verse>('/api/verses/random'),
  createRoom: () => postJson<Room>('/api/rooms'),
}
