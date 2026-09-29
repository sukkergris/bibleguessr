import { test, expect, type Page, type Browser } from '@playwright/test'

// Regression test for the verse card rendering near-black text on its dark
// surface in the dark theme. verse-card.ts hardcoded `--card-text: #1a1a1a`
// while its background already followed the theme (`--surface-raised`), so
// in dark mode the verse — the one thing the player has to read — measured
// about 1.2:1. Also covers the Guess button, white text on --accent, which
// was 4.39:1 in the dark theme (docs/SCRUM/DONE/Bug.DarkThemeAccentContrast.md).

/** WCAG relative luminance, then the standard contrast ratio. */
function contrastRatio(fg: string, bg: string): number {
  const parse = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
  const luminance = ([r, g, b]: number[]) => {
    const channel = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const [l1, l2] = [luminance(parse(fg)), luminance(parse(bg))].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 4.5:1 is the WCAG 2.2 AA threshold for body-sized text. */
let minimumContrast = 4.5

/** Foreground of the first element matching `selector` in any shadow root,
 * against the background actually painted behind it. */
async function sample(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const find = (root: Document | ShadowRoot): Element | null => {
      const here = root.querySelector(sel)
      if (here) return here
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const sr = (el as HTMLElement).shadowRoot
        if (!sr) continue
        const found = find(sr)
        if (found) return found
      }
      return null
    }

    const effectiveBg = (el: Element | null): string => {
      let node: Element | null = el
      while (node) {
        const bg = getComputedStyle(node).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
        node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)
      }
      return getComputedStyle(document.body).backgroundColor
    }

    const el = find(document)
    return el ? { fg: getComputedStyle(el).color, bg: effectiveBg(el) } : null
  }, selector)
}

async function expectReadable(page: Page, selector: string, where: string) {
  const s = await sample(page, selector)
  expect(s, `${where}: "${selector}" not found`).not.toBeNull()
  const ratio = contrastRatio(s!.fg, s!.bg)
  expect(ratio, `${where}: renders ${s!.fg} on ${s!.bg} — ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
    minimumContrast,
  )
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the game screen stays readable in the ${colorScheme} theme`, async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext({ colorScheme })
    const page = await ctx.newPage()
    try {
      await page.goto('/')
      await page.getByRole('button', { name: 'The Bible' }).first().click()
      await page.getByRole('button', { name: 'Start game' }).click()
      await expect(page.locator('.round')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Guess' })).toBeVisible()
      // The verse arrives after the round header, so wait for its text.
      await expect(page.locator('bg-verse-card .text')).toBeVisible()

      await expectReadable(page, 'blockquote .text', `verse text/${colorScheme}`)
      await expectReadable(page, 'button[type="submit"]', `Guess button/${colorScheme}`)
    } finally {
      await ctx.close()
    }
  })
}
