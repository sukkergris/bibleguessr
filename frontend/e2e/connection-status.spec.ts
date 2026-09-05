import { test, expect, type Page } from '@playwright/test'

// The connection indicator — see
// docs/SCRUM/DONE/Bug.CantTrustConnectionStatusIconRightUpperCorner.md.
// It used to wait out a 15-second HTTP poll before showing that anything
// was wrong, which made it impossible to trust.

const dotState = (page: Page) =>
  page.evaluate(() => {
    const dot = document
      .querySelector('bg-app')
      ?.shadowRoot?.querySelector('bg-connection-status')
      ?.shadowRoot?.querySelector('.dot')
    return { cls: dot?.className ?? 'none', label: dot?.getAttribute('aria-label') ?? '' }
  })

// Connectivity is restored in teardown, not at the end of each test body:
// a test that fails while offline would otherwise leave the browser
// context offline for whatever runs next in the same worker, producing
// failures in unrelated specs that look nothing like their real cause.
test.afterEach(async ({ page }) => {
  await page.context().setOffline(false)
})

async function waitForHealthy(page: Page) {
  await expect
    .poll(async () => (await dotState(page)).cls, { timeout: 15_000 })
    .toContain('ok')
}

test('losing connectivity is reflected promptly, not after the polling interval', async ({ page }) => {
  await page.goto('/')
  await waitForHealthy(page)

  await page.context().setOffline(true)

  // Well inside the healthy 15s poll: the point is that it does not wait
  // for it.
  await expect.poll(async () => (await dotState(page)).cls, { timeout: 5_000 }).toContain('bad')
})

test('the indicator describes its state in words, not by colour alone', async ({ page }) => {
  await page.goto('/')
  await waitForHealthy(page)

  expect((await dotState(page)).label).toMatch(/connected/i)

  await page.context().setOffline(true)
  await expect
    .poll(async () => (await dotState(page)).label, { timeout: 5_000 })
    .toMatch(/unreachable|disconnected|reconnecting/i)
})

test('recovering returns the indicator to connected', async ({ page }) => {
  await page.goto('/')
  await waitForHealthy(page)

  await page.context().setOffline(true)
  await expect.poll(async () => (await dotState(page)).cls, { timeout: 5_000 }).toContain('bad')

  await page.context().setOffline(false)
  // Faster polling while unhealthy means recovery is noticed quickly too,
  // rather than after the slow healthy interval.
  await expect.poll(async () => (await dotState(page)).cls, { timeout: 10_000 }).toContain('ok')
})
