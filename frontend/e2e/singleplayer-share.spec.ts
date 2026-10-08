import { test, expect, type Page } from '@playwright/test'

// Sharing a singleplayer result — see docs/web/scoring. Written like every
// share in the app (shared-kernel/result-sharing.ts): which parts of each
// verse were right, when it was played, and a link to the game.

type SharedWindow = { shared: ShareData[] }

async function stubShareMenu(page: Page) {
  await page.addInitScript(() => {
    const shared: ShareData[] = []
    ;(window as unknown as SharedWindow).shared = shared
    navigator.share = async (data?: ShareData) => {
      if (data) shared.push(data)
    }
  })
}

async function sharedText(page: Page): Promise<string> {
  await expect.poll(() => page.evaluate(() => (window as unknown as SharedWindow).shared.length)).toBe(1)
  return (await page.evaluate(() => (window as unknown as SharedWindow).shared[0].text)) ?? ''
}

/** Plays every round to the end with `guess`, then waits for the results. */
async function playToTheEnd(page: Page, guess: () => Promise<void>) {
  await expect(page.locator('.round')).toContainText('Verse 1')
  while (!(await page.getByRole('button', { name: 'Play again' }).isVisible())) {
    await guess()
    await page.getByRole('button', { name: /Next verse|See results/ }).click()
  }
}

const MARKS_LINE = /^(✅|❌) (✅|❌) (✅|❌) \d+$/

test('a singleplayer result can be shared: the game, each verse’s marks, when, and the link', async ({ page }) => {
  await stubShareMenu(page)
  await page.clock.install({ time: new Date('2026-10-01T14:32:00Z') })
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await playToTheEnd(page, async () => {
    await page.locator('bg-guess-form').getByRole('radio', { name: 'Rut' }).check()
    await page.getByRole('button', { name: 'Guess' }).click()
  })

  await page.getByRole('button', { name: 'Share result' }).click()
  const lines = (await sharedText(page)).split('\n')

  expect(lines[0]).toBe('BibleGuessr · The Bible')
  expect(lines[1]).toMatch(/^\d+ points$/)
  expect(lines[2]).toBe('Book · Chapter · Verse')
  const verseLines = lines.slice(3, -2)
  expect(verseLines.length).toBeGreaterThan(0)
  for (const line of verseLines) expect(line).toMatch(MARKS_LINE)
  expect(lines.at(-2)).toMatch(/^Played 2026-10-01 14:3\d UTC$/)
  // The game type's own address — it follows the environment.
  expect(lines.at(-1)).toBe(`${new URL(page.url()).origin}/play/the-bible`)

  // No separate title: some apps show it in front of the text, which would
  // repeat the "BibleGuessr" the text already starts with.
  const title = await page.evaluate(() => (window as unknown as SharedWindow).shared[0].title)
  expect(title).toBeUndefined()
})

// In a Chapters game the book is given — and, with one chapter picked, the
// chapter too — so those columns would always be ✅: the share leaves them
// out, keeping only what the player actually had to get right.
test('a one-chapter Chapters result shares only the verse column', async ({ page }) => {
  await stubShareMenu(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Chapters' }).click()
  await page.getByLabel('Book').selectOption('Daniel')
  await page.locator('.chapter', { hasText: '1' }).first().locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Start game' }).click()
  await playToTheEnd(page, () => page.getByRole('button', { name: 'Guess' }).click())

  await page.getByRole('button', { name: 'Share result' }).click()
  const lines = (await sharedText(page)).split('\n')
  expect(lines[0]).toBe('BibleGuessr · Chapters')
  expect(lines[2]).toBe('Verse')
  for (const line of lines.slice(3, -2)) expect(line).toBe('❌ 0')
})

test('without a share menu, a singleplayer result is copied to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await playToTheEnd(page, async () => {
    await page.locator('bg-guess-form').getByRole('radio', { name: 'Rut' }).check()
    await page.getByRole('button', { name: 'Guess' }).click()
  })

  await page.getByRole('button', { name: 'Share result' }).click()
  await expect(page.locator('bg-game-results').getByRole('status')).toHaveText('Result copied — paste it anywhere.')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.split('\n').at(-1)).toBe(`${new URL(page.url()).origin}/play/the-bible`)
})
