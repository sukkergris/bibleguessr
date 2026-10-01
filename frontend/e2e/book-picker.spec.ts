import { test, expect, type Page } from '@playwright/test'

// The guess form's book grid — see docs/web/book-picker. Players pick the
// book from tiles instead of typing it. Tile names come from the selected Bible
// (here the bundled bibelen-dk translation).

async function startBibleGame(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
}

const guessForm = (page: Page) => page.locator('bg-guess-form')

test('shows every book of the selected Bible, grouped by testament and category', async ({ page }) => {
  await startBibleGame(page)

  const form = guessForm(page)
  await expect(form.getByRole('radio')).toHaveCount(66)
  await expect(form.getByRole('group', { name: 'Old Testament' })).toBeVisible()
  await expect(form.getByRole('group', { name: 'New Testament' })).toBeVisible()

  // Names are the translation's own spelling, not a hardcoded list.
  const law = form.getByRole('group', { name: 'Law' })
  await expect(law.getByRole('radio')).toHaveCount(5)
  await expect(law.getByRole('radio').first()).toHaveAccessibleName('1.Mosebog')
  await expect(form.getByRole('group', { name: 'Prophecy' }).getByRole('radio')).toHaveAccessibleName('Aabenbaringen')
})

test('clicking a tile selects it and the guess submits without typing', async ({ page }) => {
  await startBibleGame(page)

  const daniel = guessForm(page).getByRole('radio', { name: 'Daniel' })
  await guessForm(page).locator('.book-tile', { hasText: 'Daniel' }).click()
  await expect(daniel).toBeChecked()
  await expect(guessForm(page).getByRole('status')).toHaveText('Selected: Daniel')

  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(page.locator('.feedback')).toBeVisible()
})

test('the grid is operable by keyboard alone', async ({ page }) => {
  await startBibleGame(page)

  // Focus lands on the first tile once the verse has loaded, without
  // selecting it; arrow keys move and select; Enter guesses.
  const first = guessForm(page).getByRole('radio', { name: '1.Mosebog' })
  await expect(first).toBeFocused()
  await expect(first).not.toBeChecked()

  await page.keyboard.press('ArrowRight')
  const second = guessForm(page).getByRole('radio', { name: '2.Mosebog' })
  await expect(second).toBeFocused()
  await expect(second).toBeChecked()

  await page.keyboard.press('Enter')
  await expect(page.locator('.feedback')).toBeVisible()
})
