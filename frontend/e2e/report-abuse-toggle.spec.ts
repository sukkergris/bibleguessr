import { test, expect } from '@playwright/test'

// The sticky report icon as a toggle — see
// docs/SCRUM/TODO/Feature.ToggleAbuseReport.md. This covers only the
// shell-level entry point; the form itself is covered by
// report-abuse.spec.ts.

const REPORT_ENDPOINT = '**/api/abuse-reports'

test('the icon opens the report view and closes it again', async ({ page }) => {
  await page.goto('/')

  const toggle = page.getByRole('button', { name: 'Report abuse' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeVisible()

  // The same control now describes the action it will perform.
  const closeToggle = page.getByRole('button', { name: 'Close report abuse' })
  await expect(closeToggle).toHaveAttribute('aria-expanded', 'true')

  await closeToggle.click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Report abuse' })).toHaveAttribute('aria-expanded', 'false')
})

test('closing through the icon sends no report and returns focus to the toggle', async ({ page }) => {
  let requests = 0
  await page.route(REPORT_ENDPOINT, (route) => {
    requests += 1
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Report abuse' }).click()
  await page.getByLabel(/What happened/).fill('Something I will not send')

  await page.getByRole('button', { name: 'Close report abuse' }).click()

  expect(requests).toBe(0)
  await expect(page.getByRole('button', { name: 'Report abuse' })).toBeFocused()
})

test('unsent text is discarded, matching Cancel', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Report abuse' }).click()
  await page.getByLabel(/What happened/).fill('Draft that should not persist')
  await page.getByRole('button', { name: 'Close report abuse' }).click()

  await page.getByRole('button', { name: 'Report abuse' }).click()
  await expect(page.getByLabel(/What happened/)).toHaveValue('')
})

test('the toggle cannot interrupt or duplicate an in-flight report', async ({ page }) => {
  let requests = 0
  await page.route(REPORT_ENDPOINT, async (route) => {
    requests += 1
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    return route.fulfill({ status: 200, body: JSON.stringify({ status: 'sent' }) })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Report abuse' }).click()
  await page.getByLabel(/What happened/).fill('A report in flight')
  await page.getByRole('button', { name: 'Send report' }).click()

  // While sending, the toggle must not tear the view down underneath the
  // request. Disabled is the chosen behaviour.
  const toggle = page.getByRole('button', { name: /report abuse/i })
  await expect(toggle).toBeDisabled()

  await expect(page.getByText(/your report has been sent/i)).toBeVisible({ timeout: 10_000 })
  expect(requests).toBe(1)
})

test('toggling does not disturb the underlying screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()

  const verseBefore = await page.locator('bg-verse-card .text').innerText()

  await page.getByRole('button', { name: 'Report abuse' }).click()
  await page.getByRole('button', { name: 'Close report abuse' }).click()

  await expect(page.locator('.round')).toBeVisible()
  expect(await page.locator('bg-verse-card .text').innerText()).toBe(verseBefore)
})
