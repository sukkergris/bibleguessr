import { test, expect, type Page } from '@playwright/test'

// Roster game status — see
// docs/SCRUM/TODO/Feature.ChangeIconStatusIChatWhenPlayerIsInAGame.md.
// Status appearance, challenge suppression and game-id matching are also
// exercised by multiplayer-round.spec.ts; these cover the transition and
// disconnect rules specifically.

async function joinWorldChat(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
}

test('both players become available again when their game ends', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [pageA, pageB, pageC] = await Promise.all(contexts.map((c) => c.newPage()))

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}gs`
    const bobName = `Bob${suffix}gs`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await joinWorldChat(pageC, `Carol${suffix}gs`)

    await pageA.getByRole('button', { name: new RegExp(bobName) }).click()
    await pageB
      .getByRole('listitem')
      .filter({ hasText: `${aliceName} wants to play` })
      .getByRole('button', { name: 'Accept' })
      .click()
    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // Carol sees both as busy, and cannot challenge either.
    const aliceRow = pageC.getByRole('listitem').filter({ hasText: aliceName })
    await expect(aliceRow).toContainText('in a game', { timeout: 10_000 })
    await expect(pageC.getByRole('button', { name: new RegExp(aliceName) })).toHaveCount(0)

    // Alice forfeits, ending that game.
    await pageA.getByRole('button', { name: 'Forfeit' }).click()
    await pageA
      .getByRole('dialog', { name: 'Forfeit game?' })
      .getByRole('button', { name: 'Forfeit', exact: true })
      .click()

    // Both become challengeable again on Carol's roster.
    await expect(pageC.getByRole('button', { name: new RegExp(aliceName) })).toBeVisible({ timeout: 10_000 })
    await expect(pageC.getByRole('button', { name: new RegExp(bobName) })).toBeVisible()
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('a busy player who disconnects keeps their in-a-game status', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [pageA, pageB, pageC] = await Promise.all(contexts.map((c) => c.newPage()))

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}dc`
    const bobName = `Bob${suffix}dc`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await joinWorldChat(pageC, `Carol${suffix}dc`)

    await pageA.getByRole('button', { name: new RegExp(bobName) }).click()
    await pageB
      .getByRole('listitem')
      .filter({ hasText: `${aliceName} wants to play` })
      .getByRole('button', { name: 'Accept' })
      .click()
    await expect(pageA.getByText('Round 1 /')).toBeVisible()
    await expect(pageC.getByRole('listitem').filter({ hasText: bobName })).toContainText('in a game', {
      timeout: 10_000,
    })

    // Bob's tab closes. The game has not ended — he is still in it through
    // the reconnect grace period — so his status must not silently become
    // "available" and must not become a challengeable button.
    await contexts[1].close()

    await expect(pageC.getByRole('button', { name: new RegExp(bobName) })).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})))
  }
})

// The rule the spec is most specific about: a GameOver is matched to the
// tracked game ID, not merely to the pair of player IDs. Without that, the
// same two players finishing one game and starting another would have the
// finished game's event mark them available while they are still playing.
test('a second game between the same players is not cleared by the first game ending', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [pageA, pageB, pageC] = await Promise.all(contexts.map((c) => c.newPage()))

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}sg`
    const bobName = `Bob${suffix}sg`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await joinWorldChat(pageC, `Carol${suffix}sg`)

    const playOneGame = async () => {
      await pageA.getByRole('button', { name: new RegExp(bobName) }).click()
      await pageB
        .getByRole('listitem')
        .filter({ hasText: `${aliceName} wants to play` })
        .getByRole('button', { name: 'Accept' })
        .click()
      await expect(pageA.getByText('Round 1 /')).toBeVisible({ timeout: 10_000 })
    }

    // Game one, ended by forfeit.
    await playOneGame()
    await pageA.getByRole('button', { name: 'Forfeit' }).click()
    await pageA
      .getByRole('dialog', { name: 'Forfeit game?' })
      .getByRole('button', { name: 'Forfeit', exact: true })
      .click()
    await expect(pageA.locator('bg-multiplayer-results')).toBeVisible({ timeout: 10_000 })
    await pageA.locator('bg-multiplayer-results').getByRole('button', { name: 'Back to room' }).click()
    await pageB.locator('bg-multiplayer-results').getByRole('button', { name: 'Back to room' }).click()

    // Game two, immediately, between the same two players.
    await playOneGame()

    // Carol must still see them as busy: the first game's GameOver names
    // this same pair, and must not make them look available.
    await expect(pageC.getByRole('listitem').filter({ hasText: bobName })).toContainText('in a game', {
      timeout: 10_000,
    })
    await expect(pageC.getByRole('button', { name: new RegExp(bobName) })).toHaveCount(0)
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})))
  }
})
