import { test, expect } from '@playwright/test'

// The Nerd Panel's "Is alive" row — see docs/web/connection-status. Pings
// /api/healthz while the panel is open and shows the answer with the
// round-trip time.

async function openNerdPanel(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

const isAliveValue = (page: import('@playwright/test').Page) =>
  page.locator('bg-nerd-panel .server dd')

test('shows that the server is alive, with its ping time', async ({ page }) => {
  await openNerdPanel(page)
  await expect(page.locator('bg-nerd-panel .server dt')).toHaveText('Is alive')
  await expect(isAliveValue(page)).toHaveText(/^Yes · \d+ ms$/)
})

test('says so when the server does not answer', async ({ page }) => {
  await page.route('**/api/healthz', (route) => route.abort())
  await openNerdPanel(page)
  await expect(isAliveValue(page)).toHaveText(/^No — /)
})

test('pings again while the panel stays open', async ({ page }) => {
  await page.clock.install()
  await openNerdPanel(page)
  await expect(isAliveValue(page)).toHaveText(/^Yes/)

  // The server goes away while the panel is open: the next ping shows it.
  // (Counting requests wouldn't prove this — the connection dot pings
  // /api/healthz on its own schedule too.)
  await page.route('**/api/healthz', (route) => route.abort())
  await page.clock.runFor(5_000)
  await expect(isAliveValue(page)).toHaveText(/^No — /)
})
