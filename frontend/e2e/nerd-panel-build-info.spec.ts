import { test, expect } from '@playwright/test'

// The Nerd Panel's "API image" section — see docs/web/build-info. Shows
// the image tag, commit and build context the API image was built with,
// from /api/build-info. The endpoint is mocked so the values are known.

async function openNerdPanel(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.keyboard.press('Alt+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

const buildSection = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'API image' })

const valueOf = (page: import('@playwright/test').Page, label: string) =>
  buildSection(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd')

test('shows the image tag, commit and build context', async ({ page }) => {
  const sha = 'e99dae2a1b2c3d4e5f60718293a4b5c6d7e8f901'
  await page.route('**/api/build-info', (route) =>
    route.fulfill({ json: { buildSha: sha, buildContext: 'github', imageTag: '0.0.7' } }),
  )
  await openNerdPanel(page)

  await expect(valueOf(page, 'Image tag')).toHaveText('0.0.7')
  await expect(valueOf(page, 'Commit')).toHaveText(sha)
  await expect(valueOf(page, 'Build context')).toHaveText('github')
})

test('a full commit SHA wraps instead of running out of the panel', async ({ page }) => {
  await page.route('**/api/build-info', (route) =>
    route.fulfill({
      json: { buildSha: 'e99dae2a1b2c3d4e5f60718293a4b5c6d7e8f901', buildContext: 'github', imageTag: '0.0.7' },
    }),
  )
  await openNerdPanel(page)

  // The value's box stays inside the section either way; what differs is
  // whether its text runs out past that box (scrollWidth > clientWidth).
  const commit = valueOf(page, 'Commit')
  await expect(commit).toHaveText(/^e99dae2/)
  const overflow = await commit.evaluate((dd) => dd.scrollWidth - dd.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('says a value is not set when the API runs outside an image', async ({ page }) => {
  await page.route('**/api/build-info', (route) =>
    route.fulfill({ json: { buildSha: null, buildContext: null, imageTag: null } }),
  )
  await openNerdPanel(page)

  for (const label of ['Image tag', 'Commit', 'Build context']) {
    await expect(valueOf(page, label)).toHaveText('Not set')
  }
})

test('says the values are unavailable when the API does not answer', async ({ page }) => {
  await page.route('**/api/build-info', (route) => route.abort())
  await openNerdPanel(page)

  await expect(valueOf(page, 'Image tag')).toHaveText('Unavailable')
  await expect(buildSection(page).locator('.error')).toBeVisible()
})
