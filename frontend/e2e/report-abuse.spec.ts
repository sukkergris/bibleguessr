import { test, expect, type Page } from '@playwright/test'

// Covers the abuse-reporting flow — see docs/SCRUM/Feature.ReportAbuse.md.
// The backend endpoint's own validation and rate limiting are covered by
// backend tests; these exercise what the reporter actually experiences.

const REPORT_ENDPOINT = '**/api/abuse-reports'

async function openReportForm(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Report abuse' }).click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeVisible()
}

test('the report control is reachable from anywhere and opens the report view', async ({ page }) => {
  await page.goto('/')

  // Present on the very first screen, identified by its accessible name
  // rather than its icon — the icon alone would not be enough.
  const reportButton = page.getByRole('button', { name: 'Report abuse' })
  await expect(reportButton).toBeVisible()

  await reportButton.click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeVisible()
  await expect(page.getByLabel(/What happened/)).toBeVisible()
})

test('cancelling returns to the previous screen without sending anything', async ({ page }) => {
  let requestCount = 0
  await page.route(REPORT_ENDPOINT, (route) => {
    requestCount += 1
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Multiplayer' })).toBeVisible()

  await page.getByRole('button', { name: 'Report abuse' }).click()
  await page.getByLabel(/What happened/).fill('Something abusive')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Back where we started, and nothing was submitted.
  await expect(page.getByRole('button', { name: 'Multiplayer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeHidden()
  expect(requestCount).toBe(0)
})

test('an empty or whitespace-only description cannot be submitted', async ({ page }) => {
  let requestCount = 0
  await page.route(REPORT_ENDPOINT, (route) => {
    requestCount += 1
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openReportForm(page)

  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText('Please describe what happened.')).toBeVisible()

  // Whitespace looks filled in but carries nothing for a reviewer.
  await page.getByLabel(/What happened/).fill('    ')
  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText('Please describe what happened.')).toBeVisible()

  expect(requestCount).toBe(0)
})

test('a valid report sends exactly one request even when submitted repeatedly', async ({ page }) => {
  let requestCount = 0
  await page.route(REPORT_ENDPOINT, async (route) => {
    requestCount += 1
    // Held open briefly so the second and third clicks land while the
    // first request is still in flight — the duplicate-submit window.
    await new Promise((resolve) => setTimeout(resolve, 700))
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openReportForm(page)
  await page.getByLabel(/What happened/).fill('They kept sending abusive messages.')

  await page.getByRole('button', { name: 'Send report' }).click()

  // Then hammer the form directly while that first request is still in
  // flight — clicking a disabled button does nothing, so this submits the
  // form itself, which is exactly what pressing Enter in a field does and
  // is the real duplicate-submit risk.
  await page.evaluate(() => {
    const form = document
      .querySelector('bg-app')
      ?.shadowRoot?.querySelector('bg-report-abuse')
      ?.shadowRoot?.querySelector('form')
    for (let i = 0; i < 3; i++) {
      form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    }
  })

  await expect(page.getByText(/your report has been sent/i)).toBeVisible({ timeout: 10_000 })
  expect(requestCount).toBe(1)
})

test('a successful report confirms delivery', async ({ page }) => {
  await page.route(REPORT_ENDPOINT, (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) }),
  )

  await openReportForm(page)
  await page.getByLabel(/What happened/).fill('Harassment in chat')
  await page.getByLabel(/Who are you reporting/).fill('Bob')
  await page.getByLabel(/Your email/).fill('me@example.com')
  await page.getByRole('button', { name: 'Send report' }).click()

  await expect(page.getByText(/your report has been sent/i)).toBeVisible()
})

test('only what the reporter typed is sent', async ({ page }) => {
  let body: Record<string, unknown> | undefined
  await page.route(REPORT_ENDPOINT, (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openReportForm(page)
  await page.getByLabel(/What happened/).fill('  Harassment in chat  ')
  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText(/your report has been sent/i)).toBeVisible()

  // Trimmed, optional fields absent rather than empty strings, and no
  // extra keys smuggling game state or Bible text along with it.
  expect(body).toEqual({
    description: 'Harassment in chat',
    reportedPlayer: null,
    replyTo: null,
  })
})

test('a failed delivery shows a retryable error and keeps what was typed', async ({ page }) => {
  let attempt = 0
  await page.route(REPORT_ENDPOINT, (route) => {
    attempt += 1
    if (attempt === 1) {
      return route.fulfill({
        status: 502,
        contentType: 'application/problem+json',
        body: JSON.stringify({ detail: 'Failed to send the report. Please try again later.' }),
      })
    }
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openReportForm(page)
  const description = page.getByLabel(/What happened/)
  await description.fill('They threatened me')
  await page.getByRole('button', { name: 'Send report' }).click()

  await expect(page.getByText(/failed to send the report/i)).toBeVisible()
  // The report survives the failure so it can be retried without retyping.
  await expect(description).toHaveValue('They threatened me')

  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText(/your report has been sent/i)).toBeVisible()
})

test('a rate-limited report shows the server’s message and can be retried', async ({ page }) => {
  await page.route(REPORT_ENDPOINT, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'Too many reports from this address today. Please try again tomorrow.' }),
    }),
  )

  await openReportForm(page)
  await page.getByLabel(/What happened/).fill('Abusive behaviour')
  await page.getByRole('button', { name: 'Send report' }).click()

  await expect(page.getByText(/too many reports/i)).toBeVisible()
  await expect(page.getByLabel(/What happened/)).toHaveValue('Abusive behaviour')
})

test('the form can be completed and submitted using the keyboard alone', async ({ page }) => {
  let body: Record<string, unknown> | undefined
  await page.route(REPORT_ENDPOINT, (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openReportForm(page)

  // Tab through the view until the description has focus, then keep
  // tabbing to the send button — no mouse anywhere after the form opens.
  // The exact number of stops isn't asserted (that's layout detail); what
  // matters is that both are reachable by keyboard at all.
  const description = page.getByLabel(/What happened/)
  for (let i = 0; i < 10 && !(await description.evaluate((el) => el === (el.getRootNode() as ShadowRoot | Document).activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(description).toBeFocused()
  await page.keyboard.type('Keyboard-only report')

  const send = page.getByRole('button', { name: 'Send report' })
  for (let i = 0; i < 10 && !(await send.evaluate((el) => el === (el.getRootNode() as ShadowRoot | Document).activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(send).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByText(/your report has been sent/i)).toBeVisible()
  expect(body?.description).toBe('Keyboard-only report')
})

// The sticky button itself — see docs/SCRUM/Feature.ReportButIcon.md. It is
// the entry point to the form above, deliberately not a second reporting
// flow of its own.

test('the report button is present across application phases', async ({ page }) => {
  const reportButton = page.getByRole('button', { name: 'Report abuse' })

  await page.goto('/')
  await expect(reportButton).toBeVisible()

  // Singleplayer setup.
  await page.getByRole('button', { name: 'The Bible' }).click()
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible()
  await expect(reportButton).toBeVisible()

  // Active gameplay.
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()
  await expect(reportButton).toBeVisible()
})

test('opening and closing the report view leaves the game underneath intact', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()

  const verseBefore = await page.locator('bg-verse-card .text').innerText()

  await page.getByRole('button', { name: 'Report abuse' }).click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Same round, same verse — reporting must not restart or disturb play.
  await expect(page.locator('.round')).toBeVisible()
  expect(await page.locator('bg-verse-card .text').innerText()).toBe(verseBefore)
})

test('closing the report view returns focus to the button that opened it', async ({ page }) => {
  await page.goto('/')

  const reportButton = page.getByRole('button', { name: 'Report abuse' })
  await reportButton.click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(reportButton).toBeFocused()
})
