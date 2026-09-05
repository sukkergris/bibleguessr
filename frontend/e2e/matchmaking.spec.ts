import { test, expect, type Page } from '@playwright/test'

// Random matchmaking — see
// docs/SCRUM/DONE/Feature.StartMulitplayerGameWaitForRandomPlayer.md and
// Feature.ConnectToRandomNextOpenGame.md. They are two halves of one
// queue: the first player waits, the next is matched with them.

// Private rooms rather than World chat: the queue is room-scoped, so a
// player left waiting by another test would match this test's first
// player instantly and it would never observe the waiting state at all.
async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Create a room' }).click()
  const code = page.locator('bg-room-setup h1 .code')
  await expect(code).toBeVisible()
  return (await code.innerText()).trim()
}

async function joinRoom(page: Page, name: string, roomCode: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByPlaceholder('Room code').fill(roomCode)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.locator('bg-room-setup h1 .code')).toHaveText(roomCode)
}

test('the first player waits and the second is matched with them', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const roomCode = await createRoom(pageA, `Alice${suffix}mm`)
    await joinRoom(pageB, `Bob${suffix}mm`, roomCode)

    // Nobody is waiting yet, so Alice waits.
    await pageA.getByRole('button', { name: 'Play someone random' }).click()
    await expect(pageA.getByText(/waiting for another player/i)).toBeVisible()

    // Bob asks for a match and is paired with her immediately.
    await pageB.getByRole('button', { name: 'Play someone random' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByText('Round 1 /')).toBeVisible({ timeout: 10_000 })

    // Both see the same verse — it is one shared game, not two.
    expect(await pageA.locator('bg-verse-card .text').innerText()).toBe(
      await pageB.locator('bg-verse-card .text').innerText(),
    )
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('a waiting player can stop waiting', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  try {
    await createRoom(page, `Solo${Date.now().toString().slice(-6)}`)

    await page.getByRole('button', { name: 'Play someone random' }).click()
    await expect(page.getByText(/waiting for another player/i)).toBeVisible()

    await page.getByRole('button', { name: 'Stop waiting' }).click()
    await expect(page.getByRole('button', { name: 'Play someone random' })).toBeVisible()
    await expect(page.getByText(/waiting for another player/i)).toBeHidden()
  } finally {
    await ctx.close()
  }
})

// Having cancelled, a player is out of the queue: the next person asking
// for a match must wait rather than being paired with a ghost.
test('a cancelled player is no longer in the queue', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const roomCode = await createRoom(pageA, `Alice${suffix}cx`)
    await joinRoom(pageB, `Bob${suffix}cx`, roomCode)

    await pageA.getByRole('button', { name: 'Play someone random' }).click()
    await expect(pageA.getByText(/waiting for another player/i)).toBeVisible()
    await pageA.getByRole('button', { name: 'Stop waiting' }).click()
    await expect(pageA.getByRole('button', { name: 'Play someone random' })).toBeVisible()

    await pageB.getByRole('button', { name: 'Play someone random' }).click()

    // Bob waits rather than starting a game against nobody.
    await expect(pageB.getByText(/waiting for another player/i)).toBeVisible()
    await expect(pageA.getByText('Round 1 /')).toBeHidden()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
