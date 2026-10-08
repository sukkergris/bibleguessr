import { test, expect } from '@playwright/test'

// The Social section — see docs/web/social. A standalone area of the app,
// reached from its own section on the front page. Its first content is the
// daily quiz — see daily-quiz.spec.ts.

test('the front page has a Social section below Multiplayer', async ({ page }) => {
  await page.goto('/')

  const headings = page.locator('bg-mode-select').getByRole('heading', { level: 2 })
  await expect(headings).toHaveText(['Singleplayer', 'Multiplayer', 'Social', 'About'])
  await expect(page.getByRole('button', { name: 'Social' })).toBeVisible()
})

test('the Social button opens Social, and Home comes back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Social' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Social' })).toBeVisible()

  await page.getByRole('button', { name: '← Home' }).click()
  await expect(page.locator('bg-mode-select')).toBeVisible()
})
