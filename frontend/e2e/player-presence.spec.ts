import { test, expect, type Page } from '@playwright/test'

// Exercises the connection-status dot, Online/Offline sectioning, and
// remembered-name behavior — see
// docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md. The 2-minute
// stale-player REMOVAL itself isn't driven end-to-end here (that would
// mean a real 2-minute wait) — it's covered by the backend's
// DisconnectCleanupTests.fs instead; this only checks that a dropped
// connection shows up live under an "Offline" section immediately
// (PlayerDisconnected fires right away — only the final removal waits out
// the grace period).

// The pre-join steps, stopping before the choice of which room to enter.
// The server-translation dropdown auto-selects its first option once
// loaded — wait for that (rather than a fixed timeout) before the name
// field/Join button, which are disabled until a translation is chosen
// (see docs/SCRUM/DONE/Feature.RequestToStartMPGame.md's
// per-player-translation note: this happens before the name field).
async function prepareToJoin(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
}

// A private room, so another test's players cannot appear in the roster
// this test asserts on — see
// docs/SCRUM/DONE/Task.IsolateMultiplayerTestsFromEachOther.md.
async function createRoom(page: Page, name: string): Promise<string> {
  await prepareToJoin(page, name)
  await page.getByRole('button', { name: 'Create a room' }).click()
  const code = page.locator('bg-room-setup h1 .code')
  await expect(code).toBeVisible()
  return (await code.innerText()).trim()
}

async function joinRoom(page: Page, name: string, roomCode: string) {
  await prepareToJoin(page, name)
  await page.getByPlaceholder('Room code').fill(roomCode)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.locator('bg-room-setup h1 .code')).toHaveText(roomCode)
}

test('a dropped connection moves the player into the Offline section, not clickable', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = Date.now().toString().slice(-6)
    const aliceName = `Alice${suffix}`
    const bobName = `Bob${suffix}`

    const roomCode = await createRoom(pageA, aliceName)
    await joinRoom(pageB, bobName, roomCode)

    const bobOnline = pageA.getByRole('listitem').filter({ hasText: bobName })
    await expect(bobOnline).toBeVisible()

    // Both start out connected — no "Offline" section yet.
    await expect(bobOnline).toHaveClass(/clickable/)
    await expect(pageA.getByText('Offline')).not.toBeVisible()

    // Bob's tab disappears (closing the context drops his SignalR
    // connection) -> Alice should see him move into an Offline section
    // immediately (PlayerDisconnected fires right away).
    await ctxB.close()

    await expect(pageA.getByText('Offline')).toBeVisible()
    const bobOffline = pageA.getByRole('listitem').filter({ hasText: bobName })
    await expect(bobOffline).toBeVisible()
    // He's still visible (the disconnect grace period means he isn't
    // removed outright just because his tab closed), but no longer
    // clickable — offline players can't be invited.
    await expect(bobOffline).not.toHaveClass(/clickable/)
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
