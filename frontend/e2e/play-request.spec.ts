import { test, expect, type Page } from '@playwright/test'

// Exercises the full "Start game from chat" flow end-to-end (see
// docs/SCRUM/Feature.StartMPGame.md) with two independent browser
// contexts standing in for two separate players/browsers hitting the same
// live server. Requires both dev servers already running — see
// playwright.config.ts and README.md's "Running tests" section.

async function joinWorldChat(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  // The server-translation dropdown auto-selects its first option once
  // loaded — wait for that (rather than a fixed timeout) before the name
  // field/Join button, which are disabled until a translation is chosen
  // (see docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation
  // note: this happens before the name field, not after).
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  // Lands "in-room" once the join round-trip (and the RoomPlayers/
  // ChatHistory snapshot sends) resolves.
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
}

test('player can send and withdraw a play request', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    // Unique-ish names per run so repeated local runs against a
    // long-lived World chat room don't collide with stale players from a
    // previous run.
    const suffix = Date.now().toString().slice(-6)
    const aliceName = `Alice${suffix}`
    const bobName = `Bob${suffix}`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    // Alice's roster syncs to include Bob (PlayerJoined broadcast). Scope
    // to the players list specifically — Bob's name also shows up as a
    // chat message sender once he joins ("<strong>Bob…:</strong>"), which
    // would otherwise make a bare text lookup ambiguous.
    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await expect(bobInRoster).toBeVisible()

    // Alice clicks Bob's name in the players list -> sends a play request.
    await bobInRoster.click()

    // Bob sees the request appear in his play-requests list.
    await expect(pageB.getByText(`${aliceName} wants to play`)).toBeVisible()

    // Alice sees her own outstanding request, with a Withdraw button.
    await expect(pageA.getByText(`Request sent to ${bobName}`)).toBeVisible()
    await pageA.getByRole('button', { name: 'Withdraw' }).click()

    // It disappears for Bob once withdrawn.
    await expect(pageB.getByText(`${aliceName} wants to play`)).not.toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// See docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md: a pending
// invitation is cancelled the INSTANT one party disconnects — not left
// live for the full 2-minute grace period until the removal sweep would
// otherwise catch it (see backend/Tests/DisconnectCleanupTests.fs's
// cancelPendingRequestsFor tests for the domain-level coverage of that
// timing). This only checks the live wiring reaches the UI.
test('a pending invitation is cancelled immediately if the SENDER disconnects', async ({ browser }) => {
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
    await bobInRoster.click()

    await expect(pageB.getByText(`${aliceName} wants to play`)).toBeVisible()

    // Alice (the sender) disconnects — Bob's UI should clear the request
    // live, without withdrawing it explicitly and without waiting out the
    // grace period.
    await ctxA.close()

    await expect(pageB.getByText(`${aliceName} wants to play`)).not.toBeVisible()
  } finally {
    await ctxB.close()
  }
})

test('a pending invitation is cancelled immediately if the TARGET disconnects', async ({ browser }) => {
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
    await bobInRoster.click()

    await expect(pageA.getByText(`Request sent to ${bobName}`)).toBeVisible()

    // Bob (the target) disconnects — Alice's own outstanding-request UI
    // should clear live, the same as if Bob had denied it.
    await ctxB.close()

    await expect(pageA.getByText(`Request sent to ${bobName}`)).not.toBeVisible()
  } finally {
    await ctxA.close()
  }
})
