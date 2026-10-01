import { test, expect } from '@playwright/test'

// The Social section — see docs/web/social. A standalone area of the app,
// reached from its own section on the front page. Only a placeholder for
// now.

test('the front page has a Social section below Multiplayer', async ({ page }) => {
  await page.goto('/')

  const headings = page.locator('bg-mode-select').getByRole('heading', { level: 2 })
  await expect(headings).toHaveText(['Singleplayer', 'Multiplayer', 'Social'])
  await expect(page.getByRole('button', { name: 'Social' })).toBeVisible()
})

test('the Social button opens the Social placeholder, and Home comes back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Social' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Social' })).toBeVisible()
  await expect(page.getByText('Coming soon.')).toBeVisible()

  await page.getByRole('button', { name: '← Home' }).click()
  await expect(page.locator('bg-mode-select')).toBeVisible()
})
