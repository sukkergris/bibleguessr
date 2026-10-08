import { test, expect } from '@playwright/test'

// The Nerd Panel's keyboard shortcut guide — see
// docs/SCRUM/TODO/Feature.ShortcutDescriptions.md.

async function openPanel(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.keyboard.press('Alt+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

test('the panel documents the shortcut and the ways in and out without it', async ({ page }) => {
  await openPanel(page)

  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()

  const guide = page.locator('bg-nerd-panel .shortcuts')
  await expect(guide).toContainText('Alt')
  await expect(guide).toContainText('Shift')
  await expect(guide).toContainText('N')
  await expect(guide).toContainText(/option/i)
  // The shortcut is a convenience: the guide must point at the ways that
  // always work.
  await expect(guide).toContainText(/connection menu/i)
  await expect(guide).toContainText(/close/i)
})

// Ctrl+Shift+N was the shortcut until it turned out Chrome and Edge on
// Windows open a private window on it instead.
test('Ctrl+Shift+N no longer opens the panel', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+KeyN')

  await expect(page.locator('bg-nerd-panel .panel[aria-hidden="true"]')).toHaveCount(1)
})

// Closed, the panel is only narrowed to nothing: its controls must not
// still be Tab stops.
test('a closed panel is inert', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('bg-nerd-panel .panel')).toHaveAttribute('inert', '')

  await page.keyboard.press('Alt+Shift+KeyN')
  await expect(page.locator('bg-nerd-panel .panel')).not.toHaveAttribute('inert')
})

test('the shortcut toggles the panel and repeats idempotently', async ({ page }) => {
  await page.goto('/')
  const heading = page.getByRole('heading', { name: 'Nerd stuff' })

  await page.keyboard.press('Alt+Shift+KeyN')
  await expect(heading).toBeVisible()
  await page.keyboard.press('Alt+Shift+KeyN')
  await expect(page.locator('bg-nerd-panel .panel[aria-hidden="true"]')).toHaveCount(1)

  // Repeating must not create duplicate panels.
  await page.keyboard.press('Alt+Shift+KeyN')
  await page.keyboard.press('Alt+Shift+KeyN')
  await page.keyboard.press('Alt+Shift+KeyN')
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
  await page.keyboard.press('Alt+Shift+KeyN')

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
