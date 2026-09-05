import { test, expect } from '@playwright/test'

// Remembered setup preferences — see
// docs/SCRUM/TODO/Feature.StoreGamersChoiseOfTimeLimitAndRounds.md.
// Validation of stored values is unit tested in game-preferences.test.ts;
// these cover the round trip through the real controls.

test('the singleplayer round count is restored on the next visit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()

  const slider = page.getByRole('slider', { name: /Number of (rounds|verses)/i })
  await slider.fill('8')
  await expect(page.locator('bg-game-setup .round-count-value')).toHaveText('8')

  // Leave setup entirely and come back.
  await page.reload()
  await page.getByRole('button', { name: 'The Bible' }).click()

  await expect(page.locator('bg-game-setup .round-count-value')).toHaveText('8')
  await expect(slider).toHaveValue('8')
})

test('multiplayer round count and time limit are restored together', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(`Prefs${Date.now().toString().slice(-6)}`)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()

  await page.getByRole('slider', { name: /Number of rounds/ }).fill('9')
  await page.getByRole('slider', { name: /Time per verse/ }).fill('45')
  await expect(page.locator('bg-challenge-settings .slider-value').last()).toHaveText('45s')

  await page.reload()
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(`Prefs${Date.now().toString().slice(-6)}b`)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()

  await expect(page.locator('bg-challenge-settings .slider-value').first()).toHaveText('9')
  await expect(page.locator('bg-challenge-settings .slider-value').last()).toHaveText('45s')
})

// The slider's 1-second notch is clamped up to 2; that clamped value is
// what must be remembered, never the unusable original.
test('a clamped one-second choice is remembered as two seconds', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(`Clamp${Date.now().toString().slice(-6)}`)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()

  await page.getByRole('slider', { name: /Time per verse/ }).fill('1')
  await expect(page.locator('bg-challenge-settings .slider-value').last()).toHaveText('2s')

  const stored = await page.evaluate(() => localStorage.getItem('bibleguessr:preferences:timeLimitSeconds:v1'))
  expect(stored).toBe('2')
})

test('corrupt stored preferences fall back to defaults instead of breaking setup', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('bibleguessr:preferences:roundCount:v1', 'not-a-number')
    localStorage.setItem('bibleguessr:preferences:timeLimitSeconds:v1', '9999')
  })

  await page.reload()
  await page.getByRole('button', { name: 'The Bible' }).click()

  await expect(page.locator('bg-game-setup .round-count-value')).toHaveText('5')
  await expect(page.getByRole('button', { name: 'Start game' })).toBeEnabled()
})
