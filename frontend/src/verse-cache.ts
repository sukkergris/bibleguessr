// Caches parsed local Bible files' verses in IndexedDB so a returning
// player doesn't have to re-parse a file every session, AND can pick
// between multiple files they've uploaded before (e.g. one EPUB + one RTF
// export, or several different translations) instead of only ever having
// the single most recently uploaded one available.
//
// Important: this caches the PARSED result, not the raw file. Browsers
// don't allow silently re-reading a File across sessions without a new user
// gesture, and this deliberately skips the File System Access API too (not
// supported on older/mobile-Safari-class browsers — see epub-parser.ts's
// non-blocking design, aimed at the same "runs on an old phone" goal). So a
// returning visit can only skip the parse step (this cache), not the file
// picker itself.
import type { Verse } from './types'

// Bump whenever epub-parser.ts's or rtf-parser.ts's parsing logic changes,
// so entries parsed with older, possibly-different logic are detected and
// dropped rather than silently served.
const PARSER_VERSION = 1

const DB_NAME = 'bibleguessr'
const STORE_NAME = 'local-bible-cache'

export interface CachedBible {
  fingerprint: string
  parserVersion: number
  translation: string
  verses: Verse[]
  cachedAt: number
}

/** `name:size:lastModified` — cheap to compute, no file I/O, sufficient to
 * detect "very likely the same file" without hashing tens of MB client-side.
 * Doubles as the record's storage key, so uploading the same file twice
 * overwrites its old entry rather than duplicating it. */
export function fingerprintFile(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/** The original filename, with its extension, from a cache fingerprint.
 *
 * A named function rather than an inline split at each call site: the
 * filename must be presented to the player as a filename and never as an
 * opaque cache id (see docs/SCRUM/TODO/Feature.Accessibility.md), and that
 * only holds because fingerprintFile puts the name first. Naming it keeps
 * the two definitions together, so changing the fingerprint's shape can't
 * silently turn every filename in the UI into an id. */
export function fileNameFromFingerprint(fingerprint: string): string {
  return fingerprint.split(':')[0] ?? fingerprint
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

/** Lists every cached Bible file, newest first — only entries parsed with
 * the current parser version (a stale entry from an older parser is
 * treated as absent, same as before, just per-entry instead of globally). */
export async function listCache(): Promise<CachedBible[]> {
  const db = await openDb()
  try {
    const all = await new Promise<CachedBible[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as CachedBible[])
      request.onerror = () => reject(request.error ?? new Error('Failed to read verse cache'))
    })
    return all.filter((entry) => entry.parserVersion === PARSER_VERSION).sort((a, b) => b.cachedAt - a.cachedAt)
  } finally {
    db.close()
  }
}

export async function writeCache(fingerprint: string, translation: string, verses: Verse[]): Promise<void> {
  const db = await openDb()
  try {
    const record: CachedBible = { fingerprint, parserVersion: PARSER_VERSION, translation, verses, cachedAt: Date.now() }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(record, fingerprint)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write verse cache'))
    })
  } finally {
    db.close()
  }
}

/** Removes one cached file — offered so a player can clear an entry they
 * no longer want listed (e.g. uploaded the wrong file, or wants to free
 * the storage) without clearing everything. */
export async function deleteCacheEntry(fingerprint: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(fingerprint)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete verse cache entry'))
    })
  } finally {
    db.close()
  }
}
