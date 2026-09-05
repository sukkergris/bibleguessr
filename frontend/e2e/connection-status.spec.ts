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

const realtimeValue = (page: Page) =>
  page.evaluate(() => {
    const panel = document
      .querySelector('bg-app')
      ?.shadowRoot?.querySelector('bg-connection-status')?.shadowRoot
    const row = Array.from(panel?.querySelectorAll('.row') ?? []).find((r) =>
      r.textContent?.includes('Realtime'),
    )
    const value = row?.querySelector('.value') as HTMLElement | null
    return value ? { text: value.textContent?.trim() ?? '', className: value.className } : null
  })

// The realtime row used to render green and read "not needed yet" on
// screens with no hub connection, which looked like a check that had
// passed. It reports nothing there, and should say so — see
// docs/SCRUM/BACKLOG/Flag.BrokenConnectionIndicator.md.
test('the realtime row reads as inactive where no hub connection exists', async ({ page }) => {
  await page.goto('/')
  await page.locator('bg-connection-status').click()

  await expect.poll(async () => (await realtimeValue(page))?.className).toContain('inactive')
  const value = await realtimeValue(page)
  // Neither a pass nor a failure: it does not apply here.
  expect(value?.className).not.toContain('ok')
  expect(value?.className).not.toContain('bad')
  expect(value?.text).toMatch(/not used/i)
})

test('the realtime row reports a real connection inside multiplayer', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(`Realtime${Date.now().toString().slice(-6)}`)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()

  await page.locator('bg-connection-status').click()

  await expect.poll(async () => (await realtimeValue(page))?.className).toContain('ok')
  expect((await realtimeValue(page))?.text).toMatch(/connected/i)
})
