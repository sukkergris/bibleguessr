import type { Room, Verse, VerseRestriction, VerseSource } from './types'

// Configure via a Vite env var (frontend/.env.local) if the backend isn't
// running on the default dev port, e.g. VITE_API_BASE_URL=http://localhost:5080
// Default matches backend/Api/Properties/launchSettings.json's "http" profile.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5162'

// Wraps fetch with logging so failures are easy to diagnose from the
// browser console: which URL was requested, whether the request even
// reached the server (network error) or the server responded with an
// error status, and how long it took.
//
// `body`, when given, is sent as a JSON request body (Content-Type:
// application/json) — the first use of this was /api/reports (see
// submitBugReport below); every earlier POST here sent no body at all
// (createRoom) or used query params (GET endpoints), so this is new.
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const start = performance.now()

  let response: Response
  try {
    response = await fetch(url, {
      method,
      ...(body !== undefined
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    })
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
    // ASP.NET's default problem-details error body has a "detail" field
    // with a human-readable message (e.g. /api/reports's rate-limit and
    // mail-failure responses) — surface that in the thrown error's
    // message when present, so the UI can show something more useful than
    // a bare status code; fall back to the raw body text otherwise.
    const bodyText = await response.text().catch(() => '<unreadable body>')
    const detail = (() => {
      try {
        const parsed = JSON.parse(bodyText) as { detail?: unknown }
        return typeof parsed.detail === 'string' ? parsed.detail : undefined
      } catch {
        return undefined
      }
    })()

    console.error(`[api] ${method} ${url} — ${response.status} ${response.statusText} (${durationMs}ms)`, bodyText)
    throw new Error(detail ?? `${method} ${path} failed: ${response.status} ${response.statusText}`)
  }

  console.debug(`[api] ${method} ${url} — ${response.status} (${durationMs}ms)`)
  return response.json() as Promise<T>
}

async function getJson<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

export const api = {
  baseUrl: API_BASE_URL,
  getTranslations: () => getJson<string[]>('/api/translations'),
  // `restriction` narrows the pool of candidate verses to specific
  // books/chapters — see docs/SCRUM/Feature.BibleSelector.md. Encoded as
  // repeated `book`/`bookChapter` query params (ASP.NET model-binds
  // repeated keys natively), matching this file's existing
  // one-param-per-filter convention rather than introducing a JSON body.
  getRandomVerse: (translation?: string, restriction?: VerseRestriction) => {
    const params = new URLSearchParams()
    if (translation) params.append('translation', translation)

    for (const book of restriction?.books ?? []) {
      params.append('book', book)
      for (const chapter of restriction?.chaptersByBook[book] ?? []) {
        params.append('bookChapter', `${book}:${chapter}`)
      }
    }

    const query = params.toString()
    return getJson<Verse>(`/api/verses/random${query ? `?${query}` : ''}`)
  },
  // Book spellings differ by translation (e.g. bibelen-dk's "1.Mosebog" vs.
  // the NWT sources' "1. Mosebog") — pass the current verse's translation so
  // the suggestion list only offers spellings that can actually match it.
  getBooks: (translation?: string) =>
    getJson<string[]>(`/api/books${translation ? `?translation=${encodeURIComponent(translation)}` : ''}`),
  // Same books, in Bible order rather than alphabetical — see
  // docs/SCRUM/Feature.BooksGameSorting.md. Used by the "Books" game
  // type's selection grid.
  getBooksInBibleOrder: (translation?: string) =>
    getJson<string[]>(
      `/api/books-in-bible-order${translation ? `?translation=${encodeURIComponent(translation)}` : ''}`,
    ),
  // Chapter suggestions are scoped to the book the player already guessed.
  getChapters: (book: string, translation?: string) => {
    const params = new URLSearchParams({ book })
    if (translation) params.set('translation', translation)
    return getJson<number[]>(`/api/chapters?${params}`)
  },
  // Verse-number suggestions are scoped to the book+chapter already guessed.
  getVerseNumbers: (book: string, chapter: number, translation?: string) => {
    const params = new URLSearchParams({ book, chapter: String(chapter) })
    if (translation) params.set('translation', translation)
    return getJson<number[]>(`/api/verse-numbers?${params}`)
  },
  createRoom: () => postJson<Room>('/api/rooms'),
  // Sends a Bible-file upload error report — see
  // docs/SCRUM/Feature.ErrorMessageBibleLoader.md and
  // components/report-error.ts. Rate-limited server-side (5/IP/day, 100
  // total/day); a 429 there surfaces here as a thrown Error whose message
  // is the backend's rate-limit detail text (see request()'s
  // problem-details handling above).
  submitBugReport: (report: { description: string; fileName?: string; errorMessage: string }) =>
    postJson<{ status: string }>('/api/reports', {
      description: report.description,
      fileName: report.fileName ?? null,
      errorMessage: report.errorMessage,
    }),
} satisfies VerseSource & Record<string, unknown>
