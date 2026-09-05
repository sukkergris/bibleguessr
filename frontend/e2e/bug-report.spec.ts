import { test, expect, type Page } from '@playwright/test'

// The general bug-report panel — see docs/SCRUM/TODO/Feature.BugReport.md.
// Backend validation and rate limiting are covered by backend tests; these
// cover what the reporter experiences.

const BUG_ENDPOINT = '**/api/bug-reports'
const ABUSE_ENDPOINT = '**/api/abuse-reports'

async function openPanel(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Report a bug' }).click()
  await expect(page.getByRole('heading', { name: 'Report a bug' })).toBeVisible()
}

test('the bug button is available and toggles the panel', async ({ page }) => {
  await page.goto('/')

  const toggle = page.getByRole('button', { name: 'Report a bug' })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  await expect(page.getByRole('heading', { name: 'Report a bug' })).toBeVisible()

  const close = page.getByRole('button', { name: 'Close bug report' })
  await expect(close).toHaveAttribute('aria-expanded', 'true')
  await close.click()
  await expect(page.getByRole('heading', { name: 'Report a bug' })).toBeHidden()
})

test('an empty description cannot be submitted', async ({ page }) => {
  let requests = 0
  await page.route(BUG_ENDPOINT, (route) => {
    requests += 1
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openPanel(page)
  await page.getByRole('button', { name: 'Send bug report' }).click()
  await expect(page.getByText('Please describe what happened.')).toBeVisible()

  await page.getByLabel(/What happened/).fill('   ')
  await page.getByRole('button', { name: 'Send bug report' }).click()
  await expect(page.getByText('Please describe what happened.')).toBeVisible()

  expect(requests).toBe(0)
})

test('a bug report goes to the bug endpoint, never the abuse one', async ({ page }) => {
  let bugBody: Record<string, unknown> | undefined
  let abuseRequests = 0

  await page.route(BUG_ENDPOINT, (route) => {
    bugBody = route.request().postDataJSON()
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })
  await page.route(ABUSE_ENDPOINT, (route) => {
    abuseRequests += 1
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openPanel(page)
  await page.getByLabel(/What happened/).fill('  The timer froze  ')
  await page.getByRole('button', { name: 'Send bug report' }).click()
  await expect(page.getByText(/your report has been sent/i)).toBeVisible()

  // Trimmed, optional fields absent, and nothing smuggling game state.
  expect(bugBody).toEqual({ description: 'The timer froze', context: null, replyTo: null })
  expect(abuseRequests).toBe(0)
})

test('repeated submission sends exactly one request', async ({ page }) => {
  let requests = 0
  await page.route(BUG_ENDPOINT, async (route) => {
    requests += 1
    await new Promise((resolve) => setTimeout(resolve, 700))
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openPanel(page)
  await page.getByLabel(/What happened/).fill('It froze')
  await page.getByRole('button', { name: 'Send bug report' }).click()

  await page.evaluate(() => {
    const form = document
      .querySelector('bg-app')
      ?.shadowRoot?.querySelector('bg-bug-report')
      ?.shadowRoot?.querySelector('form')
    for (let i = 0; i < 3; i++) form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  })

  await expect(page.getByText(/your report has been sent/i)).toBeVisible({ timeout: 10_000 })
  expect(requests).toBe(1)
})

test('a failed delivery is retryable and keeps what was typed', async ({ page }) => {
  let attempt = 0
  await page.route(BUG_ENDPOINT, (route) => {
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

  await openPanel(page)
  const description = page.getByLabel(/What happened/)
  await description.fill('Verse text never loaded')
  await page.getByRole('button', { name: 'Send bug report' }).click()

  await expect(page.getByText(/failed to send the report/i)).toBeVisible()
  await expect(description).toHaveValue('Verse text never loaded')

  await page.getByRole('button', { name: 'Send bug report' }).click()
  await expect(page.getByText(/your report has been sent/i)).toBeVisible()
})

test('the toggle cannot interrupt an in-flight report', async ({ page }) => {
  let requests = 0
  await page.route(BUG_ENDPOINT, async (route) => {
    requests += 1
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await openPanel(page)
  await page.getByLabel(/What happened/).fill('A report in flight')
  await page.getByRole('button', { name: 'Send bug report' }).click()

  await expect(page.getByRole('button', { name: /bug/i })).toBeDisabled()
  await expect(page.getByText(/your report has been sent/i)).toBeVisible({ timeout: 10_000 })
  expect(requests).toBe(1)
})

test('opening and closing preserves the underlying game and returns focus', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()

  const verseBefore = await page.locator('bg-verse-card .text').innerText()

  await page.getByRole('button', { name: 'Report a bug' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.locator('.round')).toBeVisible()
  expect(await page.locator('bg-verse-card .text').innerText()).toBe(verseBefore)
  await expect(page.getByRole('button', { name: 'Report a bug' })).toBeFocused()
})
