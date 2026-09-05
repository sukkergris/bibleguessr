import { test, expect, type Page } from '@playwright/test'

// Exercises accepting/denying a play request end-to-end (see
// docs/SCRUM/Feature.RequestToStartMPGame.md), with two independent
// browser contexts standing in for two separate players/browsers hitting
// the same live server. Requires both dev servers already running — see
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
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
}

test('challenged player can accept a play request, and it clears for both players', async ({ browser }) => {
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

    // Alice challenges Bob with the default "All" game type.
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await expect(requestOnBobsScreen).toBeVisible()
    // The game type Alice chose is shown alongside the request.
    // "The Bible" — the same vocabulary the challenger picked from, since
    // the selector and the request description now share one source of
    // truth (see game-type.ts's GAME_TYPE_NAMES).
    await expect(requestOnBobsScreen).toContainText('The Bible')

    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    // Resolved on both sides — Bob's incoming request disappears, and
    // Alice's own outstanding "sent" banner clears too.
    await expect(pageB.getByText(`${aliceName} wants to play`)).not.toBeVisible()
    await expect(pageA.getByText(`Request sent to ${bobName}`)).not.toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('challenged player can deny a play request, and it clears for both players', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = Date.now().toString().slice(-6)
    const aliceName = `Alice${suffix}d`
    const bobName = `Bob${suffix}d`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await expect(bobInRoster).toBeVisible()

    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await expect(requestOnBobsScreen).toBeVisible()

    await requestOnBobsScreen.getByRole('button', { name: 'Deny' }).click()

    await expect(pageB.getByText(`${aliceName} wants to play`)).not.toBeVisible()
    await expect(pageA.getByText(`Request sent to ${bobName}`)).not.toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
