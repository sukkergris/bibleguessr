import { test, expect, type Page } from '@playwright/test'

// Dark mode — see docs/SCRUM/DONE/Feature.EnableDarkmode.md. Colours live
// as semantic tokens on :root and are inherited into every shadow root, so
// these assert on the resolved theme and on real computed colours rather
// than on any component's own CSS.

const resolvedTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'))

async function openThemeControl(page: Page) {
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

test('follows the operating system by default', async ({ browser }) => {
  for (const [scheme, expected] of [
    ['dark', 'dark'],
    ['light', 'light'],
  ] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme })
    const page = await ctx.newPage()
    await page.goto('/')
    expect(await resolvedTheme(page)).toBe(expected)
    await ctx.close()
  }
})

test('an explicit choice overrides the operating system and survives reload', async ({ browser }) => {
  // A dark OS, but the player wants light.
  const ctx = await browser.newContext({ colorScheme: 'dark' })
  const page = await ctx.newPage()

  try {
    await page.goto('/')
    expect(await resolvedTheme(page)).toBe('dark')

    await openThemeControl(page)
    await page.getByRole('radio', { name: 'Light' }).check()
    expect(await resolvedTheme(page)).toBe('light')

    // The choice must not be undone by the OS on the next visit.
    await page.reload()
    expect(await resolvedTheme(page)).toBe('light')
  } finally {
    await ctx.close()
  }
})

test('corrupt stored preferences fall back to following the system', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' })
  const page = await ctx.newPage()

  try {
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('bibleguessr:theme:v1', 'midnight'))
    await page.reload()

    expect(await resolvedTheme(page)).toBe('dark')
  } finally {
    await ctx.close()
  }
})

test('dark mode actually changes rendered colours, including inside shadow roots', async ({ browser }) => {
  const readColours = (page: Page) =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body)
      // A muted-text element rather than the accent-filled buttons: those
      // are deliberately white-on-accent in BOTH themes, so they would
      // prove nothing about whether the theme reached the shadow root.
      const inner = document
        .querySelector('bg-app')
        ?.shadowRoot?.querySelector('bg-mode-select')
        ?.shadowRoot?.querySelector('p, .subtitle, small')
      return {
        bodyBg: body.backgroundColor,
        bodyText: body.color,
        innerText: inner ? getComputedStyle(inner).color : 'none',
      }
    })

  const lightCtx = await browser.newContext({ colorScheme: 'light' })
  const darkCtx = await browser.newContext({ colorScheme: 'dark' })

  try {
    const lightPage = await lightCtx.newPage()
    const darkPage = await darkCtx.newPage()
    await lightPage.goto('/')
    await darkPage.goto('/')

    const light = await readColours(lightPage)
    const dark = await readColours(darkPage)

    // The theme must reach past the shadow boundary, not just the body.
    expect(dark.bodyBg).not.toBe(light.bodyBg)
    expect(dark.bodyText).not.toBe(light.bodyText)
    expect(dark.innerText).not.toBe(light.innerText)
  } finally {
    await lightCtx.close()
    await darkCtx.close()
  }
})

test('switching theme does not disturb the game underneath', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()

  const verseBefore = await page.locator('bg-verse-card .text').innerText()

  // Focus starts in the guess field, and the panel shortcut deliberately
  // does not fire while typing (see the nerd-panel guard), so move focus
  // out first — a player would do the same by clicking elsewhere.
  await page.locator('bg-verse-card').click()
  await openThemeControl(page)
  await page.getByRole('radio', { name: 'Dark' }).check()
  expect(await resolvedTheme(page)).toBe('dark')

  await expect(page.locator('.round')).toBeVisible()
  expect(await page.locator('bg-verse-card .text').innerText()).toBe(verseBefore)
})

test('the theme control is a labelled radio group, operable by keyboard', async ({ page }) => {
  await page.goto('/')
  await openThemeControl(page)

  const dark = page.getByRole('radio', { name: 'Dark' })
  await dark.focus()
  await expect(dark).toBeFocused()
  await page.keyboard.press('Space')

  await expect(dark).toBeChecked()
  expect(await resolvedTheme(page)).toBe('dark')
})

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

// Regression test for a real defect: several surfaces kept a hard-coded
// white background in dark mode while their text turned light, leaving
// near-white on white. Keyword colours (`background: white`) were missed
// by a migration that only looked for hex literals.
test('surfaces keep readable contrast in dark mode', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' })
  const page = await ctx.newPage()

  try {
    await page.goto('/')
    await page.keyboard.press('Control+Shift+KeyN')
    await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()

    const samples = await page.evaluate(() => {
      const app = document.querySelector('bg-app')?.shadowRoot
      const panel = app?.querySelector('bg-nerd-panel')?.shadowRoot

      // Walks up for the nearest ancestor that actually paints a
      // background — a transparent element inherits whatever is behind it.
      const effectiveBg = (el: Element | null): string => {
        let node: Element | null = el
        while (node) {
          const bg = getComputedStyle(node).backgroundColor
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
          node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)
        }
        return getComputedStyle(document.body).backgroundColor
      }

      const pick = (root: ShadowRoot | null | undefined, selector: string) => {
        const el = root?.querySelector(selector) as HTMLElement | null
        return el ? { fg: getComputedStyle(el).color, bg: effectiveBg(el) } : null
      }

      return {
        panelHeading: pick(panel, 'h2'),
        panelTerm: pick(panel, 'dt'),
        body: { fg: getComputedStyle(document.body).color, bg: getComputedStyle(document.body).backgroundColor },
      }
    })

    for (const [name, sample] of Object.entries(samples)) {
      if (!sample) continue
      const ratio = contrastRatio(sample.fg, sample.bg)
      // 4.5:1 is the WCAG AA threshold for body text.
      expect(ratio, `${name}: ${sample.fg} on ${sample.bg}`).toBeGreaterThanOrEqual(4.5)
    }
  } finally {
    await ctx.close()
  }
})
