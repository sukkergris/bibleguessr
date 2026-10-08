import { test, expect, type Page } from '@playwright/test'

// Opening the nerd panel from the connection menu — the way in that needs
// no keyboard. See docs/web/connection-status and docs/web/keyboard-shortcuts.

const dot = (page: Page) => page.getByRole('button', { name: /^Connection status:/ })
const panelHeading = (page: Page) => page.locator('bg-nerd-panel').getByRole('heading', { name: 'Nerd stuff' })

async function openFromConnectionMenu(page: Page) {
  await page.goto('/')
  await dot(page).click()
  await page.getByRole('button', { name: 'Nerd panel' }).click()
}

test('the connection menu opens the nerd panel and closes itself', async ({ page }) => {
  await openFromConnectionMenu(page)

  await expect(panelHeading(page)).toBeVisible()
  // The menu would otherwise cover the top of the panel.
  await expect(page.getByRole('group', { name: 'Connection status' })).toHaveCount(0)
  await expect(dot(page)).toHaveAttribute('aria-expanded', 'false')
})

test('focus moves into the panel, and back to the dot when it closes', async ({ page }) => {
  await openFromConnectionMenu(page)

  await expect(panelHeading(page)).toBeFocused()

  await page.locator('bg-nerd-panel').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('bg-nerd-panel .panel[aria-hidden="true"]')).toHaveCount(1)
  await expect(dot(page)).toBeFocused()
})

test('the whole way in and out works from the keyboard', async ({ page }) => {
  await page.goto('/')
  await dot(page).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Nerd panel' }).focus()
  await page.keyboard.press('Enter')
  await expect(panelHeading(page)).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.locator('bg-nerd-panel').getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dot(page)).toBeFocused()
})
