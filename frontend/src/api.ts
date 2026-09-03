import type { Room, Verse } from './types'

// Configure via a Vite env var (frontend/.env.local) if the backend isn't
// running on the default dev port, e.g. VITE_API_BASE_URL=http://localhost:5080
// Default matches backend/Api/Properties/launchSettings.json's "http" profile.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5162'

// Wraps fetch with logging so failures are easy to diagnose from the
// browser console: which URL was requested, whether the request even
// reached the server (network error) or the server responded with an
// error status, and how long it took.
async function request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const start = performance.now()

  let response: Response
  try {
    response = await fetch(url, { method })
  } catch (error) {
    // fetch() throws TypeError for network-level failures: backend down,
    // wrong host/port, CORS rejection, DNS failure, etc. The browser
    // deliberately hides the exact reason, so point at the likely causes
    // both in the console (for the stack trace) and in the thrown error
    // (so it's visible wherever the UI surfaces err.message).
    const hint =
      `Could not reach ${url}. The backend may not be running, may be bound to a ` +
      `different host/port than "${API_BASE_URL}", or the request was blocked by CORS. ` +
      `Check the Network tab for details.`
    console.error(
      `[api] ${method} ${url} — network error after ${Math.round(performance.now() - start)}ms. ${hint}`,
      error,
    )
    throw new Error(hint)
  }

  const durationMs = Math.round(performance.now() - start)

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable body>')
    console.error(
      `[api] ${method} ${url} — ${response.status} ${response.statusText} (${durationMs}ms)`,
      body,
    )
    throw new Error(`${method} ${path} failed: ${response.status} ${response.statusText}`)
  }

  console.debug(`[api] ${method} ${url} — ${response.status} (${durationMs}ms)`)
  return response.json() as Promise<T>
}

async function getJson<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

async function postJson<T>(path: string): Promise<T> {
  return request<T>('POST', path)
}

export const api = {
  baseUrl: API_BASE_URL,
  getRandomVerse: () => getJson<Verse>('/api/verses/random'),
  // Book spellings differ by translation (e.g. bibelen-dk's "1.Mosebog" vs.
  // the NWT sources' "1. Mosebog") — pass the current verse's translation so
  // the suggestion list only offers spellings that can actually match it.
  getBooks: (translation?: string) =>
    getJson<string[]>(`/api/books${translation ? `?translation=${encodeURIComponent(translation)}` : ''}`),
  createRoom: () => postJson<Room>('/api/rooms'),
}
