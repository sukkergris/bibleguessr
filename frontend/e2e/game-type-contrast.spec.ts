import { test, expect, type Page, type Browser } from '@playwright/test'

// Regression test for the same defect mode-switch-contrast.spec.ts covers,
// found again in three controls that fix missed: the game-type scope pills
// (All/Books/Chapters) in the room screen, and the cached-translation
// entries in both game-setup and translation-source-select. Each styled its
// unselected state with `color: var(--surface-raised)` — a background token
// used as a foreground — so the label was painted in the surface colour
// behind it and vanished. White-on-white (1.00:1) in the light theme,
// near-black-on-black (1.22:1) in the dark theme.
//
// The labels were still in the DOM and still had accessible names, so
// neither the a11y audit nor any unit test could catch this; only a
// computed-colour check can.

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

/** Reads each matching control's foreground against the background actually
 * painted behind it. The pills are transparent, so the background has to be
 * resolved by walking up through shadow hosts rather than read off the
 * element itself. */
async function sampleControls(page: Page, selector: string) {
  return page.evaluate((sel) => {
    // The control sits several shadow roots deep and which ancestor path is
    // mounted depends on the screen, so search every shadow root rather
    // than hard-coding a path.
    const findAll = (root: Document | ShadowRoot): Element[] => {
      const here = Array.from(root.querySelectorAll(sel))
      if (here.length > 0) return here
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const sr = (el as HTMLElement).shadowRoot
        if (!sr) continue
        const found = findAll(sr)
        if (found.length > 0) return found
      }
      return []
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

    return findAll(document).map((el) => ({
      label: (el.textContent ?? '').trim(),
      selected: el.getAttribute('aria-selected') === 'true',
      fg: getComputedStyle(el).color,
      bg: effectiveBg(el),
    }))
  }, selector)
}

type Sample = { label: string; selected: boolean; fg: string; bg: string }

function expectReadable(samples: Sample[], where: string, expectedCount: number) {
  // Guards against the check silently passing on an empty list if a
  // selector ever drifts.
  expect(samples.length, `${where}: expected ${expectedCount} controls`).toBe(expectedCount)
  expect(samples.some((s) => !s.selected), `${where}: expected an unselected control`).toBe(true)

  // Scoped to the UNSELECTED state, which is what this bug was about. The
  // selected pill is --accent-text on --accent, only 4.39:1 in the dark
  // theme — the separate pre-existing token defect tracked in
  // docs/SCRUM/BUGS/Bug.DarkThemeAccentContrast.md, deliberately not fixed
  // here since it means recolouring --accent app-wide.
  for (const control of samples.filter((s) => !s.selected)) {
    const ratio = contrastRatio(control.fg, control.bg)
    expect(
      ratio,
      `${where}: "${control.label}" (unselected) renders ${control.fg} on ${control.bg} ` +
        `— ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(minimumContrast)
  }
}

async function joinWorldChat(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`game-type scope pills stay readable in the ${colorScheme} theme`, async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx = await browser.newContext({ colorScheme })
    const page = await ctx.newPage()
    try {
      // Unique-ish name so repeated local runs against a long-lived World
      // chat room don't collide with a stale player from a previous run.
      await joinWorldChat(page, `Contrast${Date.now().toString().slice(-6)}`)
      await expect(page.getByRole('tab', { name: 'The Bible' })).toBeVisible()

      // All three pills: "The Bible" (selected by default), Books, Chapters.
      expectReadable(await sampleControls(page, '.scopes button'), `game-type/${colorScheme}`, 3)
    } finally {
      await ctx.close()
    }
  })
}
