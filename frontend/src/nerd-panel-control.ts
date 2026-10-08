// The two ways into the nerd panel — see docs/web/keyboard-shortcuts.
//
// The keyboard shortcut, and a request from another part of the app (the
// connection menu's Nerd panel button), so it can be opened without a
// keyboard. bg-nerd-panel listens for both; nothing else needs to hold a
// reference to it.

/** The keys of the shortcut, in the order they're shown to the player.
 *
 * Alt+Shift+N rather than the original Ctrl+Shift+N: Chrome and Edge on
 * Windows open a private window on Ctrl+Shift+N before the page ever sees
 * the keys. On a Mac, Alt is the Option key. */
export const NERD_PANEL_SHORTCUT_KEYS = ['Alt', 'Shift', 'N'] as const

/** The shortcut as plain text, for places that can't show <kbd>s. */
export const NERD_PANEL_SHORTCUT_TEXT = NERD_PANEL_SHORTCUT_KEYS.join('+')

const SHORTCUT_LETTER = 'n'
/** The physical key, used when the key itself doesn't report a letter —
 * on a Mac, Option+Shift+N types a symbol rather than an N. */
const SHORTCUT_CODE = 'KeyN'
const SINGLE_LETTER = /^[a-z]$/i

/** The parts of a KeyboardEvent the shortcut looks at. */
export type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>

/** Whether a keydown is the nerd panel shortcut.
 *
 * Follows the letter the key types, so it works on any keyboard layout,
 * and falls back to the key's position only when it doesn't type a
 * letter. Ctrl or Cmd held as well means some other shortcut — leave it
 * alone. */
export function isNerdPanelShortcut(e: ShortcutKeyEvent): boolean {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return false
  return SINGLE_LETTER.test(e.key) ? e.key.toLowerCase() === SHORTCUT_LETTER : e.code === SHORTCUT_CODE
}

/** Asks the nerd panel to open from somewhere other than the keyboard.
 * `returnFocusTo` is where focus goes back to when the panel is closed. */
export interface NerdPanelOpenRequest {
  returnFocusTo: HTMLElement
}

const OPEN_REQUEST_EVENT = 'bg-nerd-panel-open-request'

/** Opens the nerd panel and moves focus into it. */
export function requestNerdPanelOpen(request: NerdPanelOpenRequest): void {
  window.dispatchEvent(
    new CustomEvent<NerdPanelOpenRequest>(OPEN_REQUEST_EVENT, {
      detail: request,
    }),
  )
}

/** Calls `listener` for every open request. Returns the unsubscribe. */
export function onNerdPanelOpenRequest(listener: (request: NerdPanelOpenRequest) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<NerdPanelOpenRequest>).detail)
  window.addEventListener(OPEN_REQUEST_EVENT, handler)
  return () => window.removeEventListener(OPEN_REQUEST_EVENT, handler)
}
