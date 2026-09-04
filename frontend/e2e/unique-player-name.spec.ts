import { test, expect, type Page } from '@playwright/test'

// Exercises docs/SCRUM/Featue.UniquePlayerName.md end-to-end:
// - joining with a name already held by a connected player is rejected
//   with a clear message
// - a disconnected player's own name frees up for their reconnect (this
//   is what makes a page-refresh-mid-session not lock you out of your own
//   name) — the domain-level guarantees are already fully covered by
//   backend/Tests/UniquePlayerNameTests.fs; this only checks the wiring
//   reaches the actual UI.

async function joinWorldChat(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  // See player-presence.spec.ts's joinWorldChat helper for why this wait
  // is needed before the name field/Join button.
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
}

test('joining World chat with a name already in use is rejected with a clear message', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const name = `Alice${Date.now().toString().slice(-6)}`

    await joinWorldChat(pageA, name)
    await expect(pageA.getByRole('heading', { name: 'World chat' })).toBeVisible()

    // Bob tries to join under Alice's exact, still-connected name.
    await joinWorldChat(pageB, name)

    await expect(pageB.getByText(/already taken/i)).toBeVisible()
    // Rejected — Bob never actually entered the room.
    await expect(pageB.getByRole('heading', { name: 'World chat' })).not.toBeVisible()

    // Alice is unaffected and still able to chat.
    await expect(pageA.getByRole('heading', { name: 'World chat' })).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('reconnecting under your own name succeeds once your old connection drops', async ({ browser }) => {
  const ctxA1 = await browser.newContext()
  const pageA1 = await ctxA1.newPage()
  const name = `Alice${Date.now().toString().slice(-6)}`

  await joinWorldChat(pageA1, name)
  await expect(pageA1.getByRole('heading', { name: 'World chat' })).toBeVisible()

  // Simulate a page refresh / lost connection: close the tab/context so
  // the old SignalR connection actually drops (marking that player
  // disconnected server-side), then rejoin under the identical name in
  // a fresh context — this must succeed, not be rejected as a duplicate.
  await ctxA1.close()

  const ctxA2 = await browser.newContext()
  const pageA2 = await ctxA2.newPage()
  try {
    await joinWorldChat(pageA2, name)
    await expect(pageA2.getByRole('heading', { name: 'World chat' })).toBeVisible()
    await expect(pageA2.getByText(/already taken/i)).not.toBeVisible()
  } finally {
    await ctxA2.close()
  }
})
