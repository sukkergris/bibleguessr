import { test, expect } from '@playwright/test'

// The About screen — see docs/web/about. Reached from its own section on
// the front page, the last one, after Social.

test('the front page has an About section after Social', async ({ page }) => {
  await page.goto('/')

  const headings = page.locator('bg-mode-select').getByRole('heading', { level: 2 })
  await expect(headings.last()).toHaveText('About')
  await expect(page.getByRole('button', { name: 'About' })).toBeVisible()
})

test('the About button opens About at its own address, and Home comes back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'About' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/about')
  await expect(page).toHaveTitle('About — BibleGuessr')

  await page.getByRole('button', { name: '← Home' }).click()
  await expect(page.locator('bg-mode-select')).toBeVisible()
})

test('About opens straight from its link', async ({ page }) => {
  await page.goto('/about')

  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Your own Bible stays with you' })).toBeVisible()
})
