/** What sharing a result ended in — see shareOrCopy. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/** The status line to show for each outcome — undefined where the outcome
 * speaks for itself (the share menu closed after sharing, or was cancelled). */
export const SHARE_OUTCOME_MESSAGES: Record<ShareOutcome, string | undefined> = {
  shared: undefined,
  cancelled: undefined,
  copied: 'Result copied — paste it anywhere.',
  failed: "The result couldn't be shared or copied.",
}

/**
 * Shares `text` through the device's own share menu where there is one
 * (phones, mostly), and copies it to the clipboard otherwise — or when the
 * share menu itself fails. Cancelling the share menu is not a failure.
 * Every share button in the app goes through this, so they behave alike.
 */
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      // Text only, no separate title: some apps show the title in front of
      // the text, repeating the "BibleGuessr" the text already starts with.
      await navigator.share({ text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Otherwise fall back to the clipboard below.
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch (error) {
    console.error('[share] failed to share or copy', error)
    return 'failed'
  }
}

/** The address the game is served from — so a shared link follows the
 * environment (www.bibleguessr.single in production, localhost in
 * development). */
export function gameUrl(): string {
  return `${window.location.origin}/`
}
