/**
 * The application's theme: Light, Dark, or follow the operating system.
 *
 * See docs/SCRUM/TODO/Feature.EnableDarkmode.md. Colours are defined once
 * as semantic tokens on `:root` in index.css and inherited into every Lit
 * shadow root — CSS custom properties cross shadow boundaries, which is
 * what makes one contract possible instead of per-component overrides.
 *
 * Only the preference is stored, never anything about the game.
 */

const STORAGE_KEY = 'bibleguessr:theme:v1'

export type Theme = 'light' | 'dark' | 'system'

/** The default for anyone who has not chosen: follow the OS. */
export const DEFAULT_THEME: Theme = 'system'

const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/** Narrows an arbitrary stored value to a theme.
 *
 * Anything unrecognised — corrupt, hand-edited, or written by an older
 * version — falls back to following the OS rather than leaving the
 * application unstyled or refusing to start. */
export function parseTheme(raw: string | null): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : DEFAULT_THEME
}

/** Reads the stored preference, tolerating storage being unavailable (as
 * in private browsing). */
export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/** Remembers the preference. A no-op if storage is unavailable — losing
 * the preference is never worth failing over. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // See the function doc.
  }
}

/** Which palette a preference actually resolves to right now.
 *
 * `system` is not a palette, so it has to be resolved against the OS at
 * the moment of asking — and re-resolved whenever the OS changes, which
 * is why applyTheme listens for that. */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

/**
 * Applies `theme` to the document, and keeps following the OS while the
 * preference is `system`.
 *
 * Sets `data-theme` on `<html>` for the token definitions to key off, and
 * `color-scheme` so browser-rendered UI — form controls, scrollbars —
 * matches rather than staying stubbornly light.
 *
 * Returns a function that stops following the OS, so a caller replacing
 * the theme does not leave an old listener behind reacting to changes.
 */
export function applyTheme(theme: Theme): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')

  const paint = () => {
    const resolved = resolveTheme(theme, query.matches)
    const root = document.documentElement
    root.setAttribute('data-theme', resolved)
    root.style.colorScheme = resolved
  }

  paint()

  // Only a `system` preference cares about OS changes; an explicit choice
  // should stay put when the OS flips.
  if (theme !== 'system') return () => {}

  query.addEventListener('change', paint)
  return () => query.removeEventListener('change', paint)
}
