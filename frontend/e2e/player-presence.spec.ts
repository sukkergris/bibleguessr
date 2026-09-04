import { test, expect, type Page } from '@playwright/test'

// Exercises the connection-status dot and remembered-name behavior added
// alongside "Start game from chat". The 5-minute stale-player removal
// itself isn't driven end-to-end here (that would mean a real 5-minute
// wait) — it's covered by the backend's DisconnectCleanupTests.fs instead;
// this only checks that a dropped connection shows up live as a status dot.

async function joinWorldChat(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
}

test('a dropped connection shows a disconnected status dot for other players', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = Date.now().toString().slice(-6)
    const aliceName = `Alice${suffix}`
    const bobName = `Bob${suffix}`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await expect(bobInRoster).toBeVisible()

    // Both start out connected.
    await expect(bobInRoster.locator('.status-dot')).toHaveClass(/connected/)

    // Bob's tab disappears (closing the context drops his SignalR
    // connection) -> Alice should see his dot flip to disconnected.
    await ctxB.close()

    await expect(bobInRoster.locator('.status-dot')).toHaveClass(/disconnected/)
    // He's still visible in the roster — the disconnect grace period
    // means he isn't removed outright just because his tab closed.
    await expect(bobInRoster).toBeVisible()
  } finally {
    await ctxA.close()
  }
})

test('a browser remembers the player name across visits', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()

  const nameInput = page.getByPlaceholder('e.g. Alice')
  await expect(nameInput).toHaveValue('')

  const name = `Remembered${Date.now().toString().slice(-6)}`
  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()

  // Reload lands back on the mode-select screen — go to Multiplayer again
  // and confirm the name survived in this browser's localStorage.
  await page.reload()
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByPlaceholder('e.g. Alice')).toHaveValue(name)
})
