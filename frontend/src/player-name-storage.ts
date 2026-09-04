// Remembers the player's chosen name in this browser, so they don't have
// to retype it every time they open the multiplayer screen. Deliberately
// just a name, not an identity — the server still mints a fresh PlayerId
// on every join (see backend/Api/GameHub.fs's JoinExistingRoom), this only
// pre-fills the name input.
const STORAGE_KEY = 'bibleguessr:playerName'

/** Reads the remembered player name, if any. Never throws — localStorage
 * can be unavailable (private browsing, storage disabled), in which case
 * this just behaves as if nothing were remembered. */
export function loadRememberedPlayerName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Remembers `name` for next time. A no-op (not an error) if localStorage
 * is unavailable — losing this convenience shouldn't break joining a room. */
export function saveRememberedPlayerName(name: string): void {
  try {
    if (name.trim()) {
      localStorage.setItem(STORAGE_KEY, name)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Ignored — see function doc.
  }
}
