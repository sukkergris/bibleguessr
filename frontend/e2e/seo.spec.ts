import { test, expect, type Page } from '@playwright/test'

// What each page tells search engines — see docs/web/seo. The pages are
// built by the app, so these check the head as the app leaves it.

const SITE_URL = 'https://bibleguessr.uk'

const canonical = (page: Page) => page.locator('head link[rel="canonical"]')
const description = (page: Page) => page.locator('head meta[name="description"]')
const robots = (page: Page) => page.locator('head meta[name="robots"]')

test('each page describes itself and names its own address', async ({ page }) => {
  await page.goto('/social/daily-quiz')

  await expect(page).toHaveTitle('Daily quiz — BibleGuessr')
  await expect(description(page)).toHaveAttribute('content', /daily Bible quiz/)
  await expect(canonical(page)).toHaveAttribute('href', `${SITE_URL}/social/daily-quiz`)
  await expect(robots(page)).toHaveCount(0)

  // Moving within the app updates the same tags rather than adding more.
  await page.getByRole('button', { name: '← Home' }).click()
  await expect(canonical(page)).toHaveAttribute('href', `${SITE_URL}/`)
  await expect(canonical(page)).toHaveCount(1)
  await expect(description(page)).toHaveCount(1)
  await expect(description(page)).toHaveAttribute('content', /Play alone, live with friends/)
})

test("a room's pages are kept out of search results", async ({ page }) => {
  await page.goto('/multiplayer/4821')

  await expect(robots(page)).toHaveAttribute('content', 'noindex')
  await expect(canonical(page)).toHaveCount(0)

  await page.getByRole('button', { name: '← Home' }).click()
  await expect(robots(page)).toHaveCount(0)
  await expect(canonical(page)).toHaveCount(1)
})

test('the sitemap lists the pages, and each one opens as itself', async ({ page, request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toMatch(/xml/)

  const paths = [...(await response.text()).matchAll(/<loc>https:\/\/bibleguessr\.uk([^<]*)<\/loc>/g)].map(
    (match) => match[1],
  )
  expect(paths).toContain('/social/daily-quiz')

  for (const path of paths) {
    await page.goto(path)
    await expect(canonical(page)).toHaveAttribute('href', `${SITE_URL}${path}`)
  }
})

test('robots.txt points search engines at the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt')

  expect(response.ok()).toBe(true)
  expect(await response.text()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
})

// The public address comes from the site configuration
// (/config/environmentVariables.json — see docs/web/site-config), not
// from the code.
test('canonical links follow the configured address', async ({ page }) => {
  await page.route('**/config/environmentVariables.json', (route) =>
    route.fulfill({ json: { siteUrl: 'https://staging.example' } }),
  )

  await page.goto('/social')

  await expect(canonical(page)).toHaveAttribute('href', 'https://staging.example/social')
})

test('without a configuration, pages still work and simply have no canonical link', async ({ page }) => {
  await page.route('**/config/environmentVariables.json', (route) => route.abort())
  const reported = page.waitForEvent('console', (message) => message.text().includes('[site-config]'))

  await page.goto('/social')
  await reported

  await expect(page.getByRole('button', { name: /Play today's quiz/ })).toBeVisible()
  await expect(page).toHaveTitle('Social — BibleGuessr')
  await expect(canonical(page)).toHaveCount(0)
})
