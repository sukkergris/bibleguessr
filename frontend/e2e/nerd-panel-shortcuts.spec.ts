import { test, expect } from '@playwright/test'

// The Nerd Panel's keyboard shortcut guide — see
// docs/SCRUM/TODO/Feature.ShortcutDescriptions.md.

async function openPanel(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

test('the panel documents the shortcut and its browser caveat', async ({ page }) => {
  await openPanel(page)

  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()

  const guide = page.locator('bg-nerd-panel .shortcuts')
  await expect(guide).toContainText('Ctrl')
  await expect(guide).toContainText('Shift')
  await expect(guide).toContainText('N')
  // The chord is reserved by some browsers for a private window, so the
  // guide must say so rather than promise it always works.
  await expect(guide).toContainText(/private|incognito/i)
  // ...and must point at the reliable alternative.
  await expect(guide).toContainText(/close/i)
})

test('the shortcut toggles the panel and repeats idempotently', async ({ page }) => {
  await page.goto('/')
  const heading = page.getByRole('heading', { name: 'Nerd stuff' })

  await page.keyboard.press('Control+Shift+KeyN')
  await expect(heading).toBeVisible()
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.locator('bg-nerd-panel .panel[aria-hidden="true"]')).toHaveCount(1)

  // Repeating must not create duplicate panels.
  await page.keyboard.press('Control+Shift+KeyN')
  await page.keyboard.press('Control+Shift+KeyN')
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.locator('bg-nerd-panel')).toHaveCount(1)
  await expect(heading).toBeVisible()
})

// A global chord must not fire while the user is typing — otherwise it
// interrupts ordinary input, which the spec explicitly forbids.
test('the shortcut does not fire while typing in a text field', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')

  const nameField = page.getByPlaceholder('e.g. Alice')
  await nameField.click()
  await page.keyboard.press('Control+Shift+KeyN')

  await expect(page.locator('bg-nerd-panel .panel[aria-hidden="true"]')).toHaveCount(1)
})

test('the guide uses semantic term/description pairs and a reachable close button', async ({ page }) => {
  await openPanel(page)

  // Shortcut/action pairs are a definition list, not visual-only markup.
  await expect(page.locator('bg-nerd-panel .shortcuts dt')).not.toHaveCount(0)
  await expect(page.locator('bg-nerd-panel .shortcuts dd')).not.toHaveCount(0)

  const close = page.getByRole('button', { name: /close/i })
  await close.focus()
  await expect(close).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('bg-nerd-panel .panel[aria-hidden="true"]')).toHaveCount(1)
})
