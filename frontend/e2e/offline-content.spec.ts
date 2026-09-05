import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Scoped to bg-game-setup rather than the whole page: the nerd panel is
// developer diagnostics and legitimately reports that it cannot reach the
// backend, which is exactly what this spec simulates. Counting that as a
// user-facing error banner would make the assertion mean the opposite of
// what it says.
//
// Exercises docs/SCRUM/Feature.OflineContentGaminig.md: a player must
// always be able to start a singleplayer game from an uploaded Bible file
// — this must never depend on the backend being reachable. This spec
// deliberately routes every backend request to a black hole (`route.abort()`
// on `**/api/**`) rather than just not starting a local backend, so it
// proves the guarantee even in an environment where a real backend happens
// to be running elsewhere.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort())
})

test('uploading and playing a local file works with the backend fully unreachable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible', exact: false }).first().click()

  // The setup screen defaults to "Server translation" mode, so the
  // backend-down error is expected here — switching to file mode is what
  // must make it disappear (see game-setup.ts's mode-scoped error banner).
  await page.getByRole('tab', { name: 'My own Bible file' }).click()
  await expect(page.locator('bg-game-setup .error')).toHaveCount(0)

  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures/offline-test.zip'))

  // Parsing is entirely client-side — should reach "ready" with no backend.
  await expect(page.getByText(/^✓ Using/)).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')

  // A full round trip — guess, see feedback, advance — all client-side.
  await page.locator('bg-guess-form input').first().fill('Genesis')
  await page.keyboard.press('Enter')
  await expect(page.locator('.feedback')).toBeVisible()

  // Still no error banner anywhere in this flow.
  await expect(page.locator('bg-game-setup .error')).toHaveCount(0)
})

test('switching to "Server translation" mode still shows the error there, without breaking file mode first', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible', exact: false }).first().click()

  // File mode first — no error.
  await page.getByRole('tab', { name: 'My own Bible file' }).click()
  await expect(page.locator('bg-game-setup .error')).toHaveCount(0)

  // Switching to server mode surfaces the failure — this is the one place
  // it's actually relevant to the player.
  await page.getByRole('tab', { name: 'Server translation' }).click()
  await expect(page.locator('bg-game-setup .error')).toBeVisible()

  // Switching back to file mode hides it again — the error was never a
  // file-mode problem to begin with.
  await page.getByRole('tab', { name: 'My own Bible file' }).click()
  await expect(page.locator('bg-game-setup .error')).toHaveCount(0)
})
