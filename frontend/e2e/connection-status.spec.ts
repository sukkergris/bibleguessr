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
  // "No network on this device" when the browser itself is offline: the
  // dot names the most specific problem it knows about, and blaming the
  // server for a local network drop was the misleading case the device
  // row was added to fix.
  await expect
    .poll(async () => (await dotState(page)).label, { timeout: 5_000 })
    .toMatch(/no network on this device|unreachable|disconnected|reconnecting/i)
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

// The panel uses two colours and no more: red means something is wrong,
// green means nothing is. Where no hub connection exists there is nothing
// broken, so the row is green and the *text* carries the fact that it is
// not in use — a third colour for "not applicable" was tried and dropped.
test('the realtime row is green and says it is unused where no hub connection exists', async ({ page }) => {
  await page.goto('/')
  await page.locator('bg-connection-status').click()

  await expect.poll(async () => (await realtimeValue(page))?.className).toContain('ok')
  const value = await realtimeValue(page)
  expect(value?.className).not.toContain('bad')
  expect(value?.text).toMatch(/not used/i)
})

const rowStates = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('bg-app')?.shadowRoot?.querySelector('bg-connection-status')?.shadowRoot
    return Array.from(panel?.querySelectorAll('.row') ?? []).map((row) => ({
      term: row.querySelector('dt')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      className: (row.querySelector('.value') as HTMLElement | null)?.className ?? '',
    }))
  })

// The dot used to derive its colour from HTTP and SignalR only, ignoring
// the browser's own connectivity — so a device with no network showed a
// green dot above a panel whose first row said "offline". Any red row
// must turn the dot red.
test('a red row inside the panel turns the dot red', async ({ page }) => {
  await page.goto('/')
  await waitForHealthy(page)
  await page.locator('bg-connection-status').click()

  // Deliberately NOT `context.setOffline`: that fails the health check in
  // the same instant, so the dot would go red for its own reasons and the
  // test could not tell whether the device row contributed at all
  // (measured — both rows turned red inside the same 25ms sample).
  //
  // Faking `navigator.onLine` alone produces the case that actually
  // isolates the rule: the device says it has no network while the server
  // is still perfectly reachable. Exactly the state where the old dot
  // stayed green above a red row.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })

  const state = async () =>
    page.evaluate(() => {
      const shadow = document.querySelector('bg-app')?.shadowRoot?.querySelector('bg-connection-status')?.shadowRoot
      return {
        rows: Array.from(shadow?.querySelectorAll('.row .value') ?? []).map((v) => (v as HTMLElement).className),
        dot: shadow?.querySelector('.dot')?.className ?? '',
      }
    })

  await expect.poll(async () => (await state()).rows.some((cls) => cls.includes('bad')), { timeout: 5_000 }).toBe(true)

  const settled = await state()
  // The health row stays green — the server really is reachable — which
  // is what makes this a test of propagation rather than of the health
  // check failing.
  expect(settled.rows.filter((cls) => cls.includes('bad'))).toHaveLength(1)
  expect(settled.dot).toContain('bad')
})

// The device row exists so that a local network drop reads as a local
// problem rather than as "Server unreachable", which blamed the server.
test('the device row reflects the browser going offline', async ({ page }) => {
  await page.goto('/')
  await waitForHealthy(page)
  await page.locator('bg-connection-status').click()

  const deviceRow = async () => (await rowStates(page)).find((row) => row.term.includes('This device'))
  expect((await deviceRow())?.className).toContain('ok')

  await page.context().setOffline(true)
  await expect.poll(async () => (await deviceRow())?.className, { timeout: 5_000 }).toContain('bad')
})

// The countdown says how old the latency figure is. It lives in the
// health-check row rather than under the panel, because it counts down to
// that specific check.
test('the health-check row shows a countdown to the next check', async ({ page }) => {
  await page.goto('/')
  await waitForHealthy(page)
  await page.locator('bg-connection-status').click()

  const countdown = () =>
    page.evaluate(() => {
      const shadow = document.querySelector('bg-app')?.shadowRoot?.querySelector('bg-connection-status')?.shadowRoot
      const row = Array.from(shadow?.querySelectorAll('.row') ?? []).find((r) => r.textContent?.includes('healthz'))
      const next = row?.querySelector('.next-check') as HTMLElement | null
      return { text: next?.textContent?.trim() ?? '', hidden: next?.getAttribute('aria-hidden') ?? '' }
    })

  await expect.poll(async () => (await countdown()).text).toMatch(/^\d+s$/)
  // Ticking once a second is useful to look at and useless to hear.
  expect((await countdown()).hidden).toBe('true')

  const first = Number((await countdown()).text.replace('s', ''))
  await expect.poll(async () => Number((await countdown()).text.replace('s', '')), { timeout: 4_000 }).toBeLessThan(
    first,
  )
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

// The panel used to open straight into two data rows with nothing saying
// what they described — no visible heading, and no accessible name for a
// screen-reader user landing in it.
test('the details panel names itself', async ({ page }) => {
  await page.goto('/')
  await page.locator('bg-connection-status').click()

  const panel = page.locator('bg-connection-status .details')
  await expect(panel).toBeVisible()
  await expect(panel.locator('h2')).toHaveText('Connection status')

  // The heading also names the group, so assistive technology announces
  // what the rows belong to rather than reading them bare.
  const labelledBy = await panel.getAttribute('aria-labelledby')
  expect(labelledBy).toBeTruthy()
  await expect(panel.locator(`#${labelledBy}`)).toHaveText('Connection status')
})
