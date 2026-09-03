// Caches a parsed local Bible file's verses in IndexedDB so a returning
// player doesn't have to re-parse the EPUB every session.
//
// Important: this caches the PARSED result, not the raw file. Browsers
// don't allow silently re-reading a File across sessions without a new user
// gesture, and this deliberately skips the File System Access API too (not
// supported on older/mobile-Safari-class browsers — see epub-parser.ts's
// non-blocking design, aimed at the same "runs on an old phone" goal). So a
// returning visit can only skip the parse step (this cache), not the file
// picker itself.
import type { Verse } from './types'

// Bump whenever epub-parser.ts's parsing logic changes, so a stale cache
// (parsed with older, possibly-different logic) is detected and dropped
// rather than silently served.
const PARSER_VERSION = 1

const DB_NAME = 'bibleguessr'
const STORE_NAME = 'local-bible-cache'
const RECORD_KEY = 'current'

export interface CachedBible {
  fingerprint: string
  parserVersion: number
  translation: string
  verses: Verse[]
  cachedAt: number
}

/** `name:size:lastModified` — cheap to compute, no file I/O, sufficient to
 * detect "very likely the same file" without hashing tens of MB client-side. */
export function fingerprintFile(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
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

/** Reads the cached parse, if any, and only if it matches the current parser
 * version (a stale cache from an older parser is treated as absent). */
export async function readCache(): Promise<CachedBible | undefined> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY)
      request.onsuccess = () => {
        const record = request.result as CachedBible | undefined
        resolve(record?.parserVersion === PARSER_VERSION ? record : undefined)
      }
      request.onerror = () => reject(request.error ?? new Error('Failed to read verse cache'))
    })
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
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write verse cache'))
    })
  } finally {
    db.close()
  }
}
