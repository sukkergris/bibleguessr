import { test, expect, type Page } from '@playwright/test'

// The Nerd Panel's "Is alive" and "Next check" rows — see
// docs/web/connection-status. They show the app's one /api/healthz check
// (src/server-health.ts), the same one the connection indicator shows:
// one request per check, the same result, the same countdown.

const HEALTHY_INTERVAL_MS = 15_000
const UNHEALTHY_INTERVAL_SECONDS = 3

async function openNerdPanel(page: Page) {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

const valueOf = (page: Page, label: string) =>
  page
    .locator('bg-nerd-panel .server dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .locator('dd')

const isAliveValue = (page: Page) => valueOf(page, 'Is alive')
const nextCheck = (page: Page) => page.locator('bg-nerd-panel .server').getByRole('timer')

/** The connection indicator's health-check row: its result, and its
 * countdown in seconds. */
const indicatorHealth = (page: Page) =>
  page.evaluate(() => {
    const shadow = document.querySelector('bg-app')?.shadowRoot?.querySelector('bg-connection-status')?.shadowRoot
    const row = Array.from(shadow?.querySelectorAll('.row') ?? []).find((r) => r.textContent?.includes('healthz'))
    const value = row?.querySelector('.value')
    const countdown = value?.querySelector('.next-check')?.textContent?.trim() ?? ''
    const text = Array.from(value?.childNodes ?? [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join('')
      .trim()
    return { text, seconds: Number(countdown.replace('s', '')) }
  })

test('shows that the server is alive, with its round-trip time', async ({ page }) => {
  await openNerdPanel(page)
  await expect(page.locator('bg-nerd-panel .server dt')).toHaveText(['Is alive', 'Next check'])
  await expect(isAliveValue(page)).toHaveText(/^OK · \d+ ms$/)
})

test('says so when the server cannot be reached', async ({ page }) => {
  await page.route('**/api/healthz', (route) => route.abort())
  await openNerdPanel(page)
  await expect(isAliveValue(page)).toHaveText('Could not reach the server')
})

test('shows the same check and countdown as the connection indicator', async ({ page }) => {
  await page.clock.install()
  await openNerdPanel(page)
  await page.locator('bg-connection-status').click()
  await expect(isAliveValue(page)).toHaveText(/^OK/)

  // Paused, so the two are read at the same moment.
  await page.clock.pauseAt(Date.now() + 2_500)
  const indicator = await indicatorHealth(page)
  await expect(isAliveValue(page)).toHaveText(indicator.text)
  await expect(nextCheck(page)).toHaveText(`in ${indicator.seconds} s`)
})

test('makes one request per check, however many places show it', async ({ page }) => {
  let requests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/healthz')) requests++
  })
  await page.clock.install()
  await openNerdPanel(page)
  await page.locator('bg-connection-status').click()
  await expect(isAliveValue(page)).toHaveText(/^OK/)
  expect(requests).toBe(1)

  await page.clock.runFor(HEALTHY_INTERVAL_MS)
  await expect.poll(() => requests).toBe(2)
  await page.clock.runFor(1_000)
  expect(requests).toBe(2)
})

test('counts down to the next check, and starts over when it happens', async ({ page }) => {
  await page.clock.install()
  await openNerdPanel(page)
  await expect(isAliveValue(page)).toHaveText(/^OK/)
  await expect(nextCheck(page)).toHaveText('in 15 s')

  await page.clock.runFor(1_000)
  await expect(nextCheck(page)).toHaveText('in 14 s')

  // The server goes away: the check when the countdown runs out shows
  // it, and the next one comes sooner, since something is now wrong.
  await page.route('**/api/healthz', (route) => route.abort())
  await page.clock.runFor(HEALTHY_INTERVAL_MS - 1_000)
  await expect(isAliveValue(page)).toHaveText('Could not reach the server')
  await expect(nextCheck(page)).toHaveText(`in ${UNHEALTHY_INTERVAL_SECONDS} s`)
})
