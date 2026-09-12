import { test, expect, type Page, type Browser } from '@playwright/test'

// Regression test for a real defect: both copies of the translation-source
// mode switch styled the *unselected* tab with `color: var(--surface-raised)`
// — a background token used as a foreground — so the label was painted in the
// surface colour behind it and vanished. White-on-white in the light theme,
// near-black-on-black in the dark theme. See
// docs/SCRUM/DONE/Bug.ModeSwitchTabLabelInvisible.md.
//
// The label was still in the DOM and still had an accessible name, so the
// existing a11y audit could not catch this; only a computed-colour check can.

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

/** Reads every mode-switch tab's foreground against the background actually
 * painted behind it — the pill itself is transparent, so the colour has to be
 * resolved by walking up through shadow hosts. */
async function sampleTabs(page: Page) {
  return page.evaluate(() => {
    // The switch lives several shadow roots deep (bg-app > bg-game-setup, or
    // bg-app > bg-room-setup > bg-translation-source-select), and which one is
    // mounted depends on the screen — so find the tablist by walking every
    // shadow root rather than hard-coding either path.
    const findTabs = (root: Document | ShadowRoot): Element[] => {
      const here = Array.from(root.querySelectorAll('.mode-switch button'))
      if (here.length > 0) return here
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const sr = (el as HTMLElement).shadowRoot
        if (!sr) continue
        const found = findTabs(sr)
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

    return findTabs(document).map((el) => ({
      label: (el.textContent ?? '').trim(),
      selected: el.getAttribute('aria-selected') === 'true',
      fg: getComputedStyle(el).color,
      bg: effectiveBg(el),
    }))
  })
}

function expectReadable(samples: Awaited<ReturnType<typeof sampleTabs>>, where: string) {
  // Guards against the check silently passing on an empty list if the
  // selector ever drifts.
  expect(samples.length, `${where}: expected both mode-switch tabs`).toBe(2)
  expect(samples.some((s) => !s.selected), `${where}: expected one unselected tab`).toBe(true)

  // Scoped to the UNSELECTED tab, which is what this bug was about. The
  // selected tab is white on --accent, which is only 4.39:1 in the dark
  // theme — a separate, pre-existing defect in the theme token itself that
  // affects every accent-filled control app-wide, not just this switch. It
  // is tracked in docs/SCRUM/BUGS/Bug.DarkThemeAccentContrast.md; fixing it
  // means recolouring --accent, which is deliberately not done here.
  for (const tab of samples.filter((s) => !s.selected)) {
    const ratio = contrastRatio(tab.fg, tab.bg)
    expect(
      ratio,
      `${where}: "${tab.label}" (${tab.selected ? 'selected' : 'unselected'}) ` +
        `renders ${tab.fg} on ${tab.bg} — ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(minimumContrast)
  }
}

async function openSingleplayerSetup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible()
}

async function openMultiplayerSetup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('tab', { name: 'Server translation' })).toBeVisible()
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`singleplayer mode-switch tabs stay readable in the ${colorScheme} theme`, async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx = await browser.newContext({ colorScheme })
    const page = await ctx.newPage()
    try {
      await openSingleplayerSetup(page)
      expectReadable(await sampleTabs(page), `singleplayer/${colorScheme}`)
    } finally {
      await ctx.close()
    }
  })

  test(`multiplayer mode-switch tabs stay readable in the ${colorScheme} theme`, async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx = await browser.newContext({ colorScheme })
    const page = await ctx.newPage()
    try {
      await openMultiplayerSetup(page)
      expectReadable(await sampleTabs(page), `multiplayer/${colorScheme}`)
    } finally {
      await ctx.close()
    }
  })
}

test('both mode-switch tabs show a visible focus indicator', async ({ page }) => {
  await openSingleplayerSetup(page)

  // Focus has to arrive via real keyboard input: `:focus-visible` is a
  // browser heuristic that a programmatic el.focus() does not satisfy, so
  // measuring after a scripted focus would report "no outline" even on a
  // correctly styled button.
  for (const name of ['Server translation', 'My own Bible file']) {
    const tab = page.getByRole('tab', { name })
    await tab.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(tab).toBeFocused()

    const outline = await tab.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        // `outline-style: none` or a zero width means nothing is drawn.
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth) || 0,
        color: style.outlineColor,
      }
    })

    expect(outline.style, `"${name}" has no focus outline style`).not.toBe('none')
    expect(outline.width, `"${name}" has a zero-width focus outline`).toBeGreaterThanOrEqual(2)
  }
})
