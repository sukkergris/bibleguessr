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

// The policy has to be visible where the choice is made, not only in
// developer docs — see docs/SCRUM/BUGS/Bug.PlaySomeoneRandom.md. A player
// who joins an existing game gets that game's settings, and must be told
// so before they commit rather than discovering it mid-game.
test('the matchmaking control explains whose settings apply', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  try {
    await createRoom(page, `Policy${Date.now().toString().slice(-6)}`)

    const matchmaking = page.locator('bg-room-setup .matchmaking')
    await expect(matchmaking).toContainText(/settings/i)
    // Says both halves: yours apply if you wait, theirs if you join.
    await expect(matchmaking).toContainText(/already waiting|existing game/i)

    await page.getByRole('button', { name: 'Play someone random' }).click()
    await expect(page.getByText(/waiting for another player/i)).toBeVisible()

    // While waiting, it must be clear these are the settings on offer.
    await expect(matchmaking).toContainText(/your settings/i)
  } finally {
    await ctx.close()
  }
})

test('a matched game uses the waiting player’s settings, consistently for both', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const roomCode = await createRoom(pageA, `Alice${suffix}st`)
    await joinRoom(pageB, `Bob${suffix}st`, roomCode)

    // Deliberately conflicting choices.
    await pageA.getByRole('slider', { name: /Number of rounds/ }).fill('3')
    await pageA.getByRole('button', { name: 'Play someone random' }).click()
    await expect(pageA.getByText(/waiting for another player/i)).toBeVisible()

    await pageB.getByRole('slider', { name: /Number of rounds/ }).fill('10')
    await pageB.getByRole('button', { name: 'Play someone random' }).click()

    // Alice waited, so her 3 rounds win — and both players see the same
    // game, not two different views of it.
    await expect(pageA.getByText('Round 1 / 3')).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByText('Round 1 / 3')).toBeVisible({ timeout: 10_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// The queue must carry the game type and time limit, not just the round
// count, and they must survive into the session unchanged — the bug
// report is explicit that all three travel together.
test('the waiting player’s time limit and verse restriction reach the game', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const roomCode = await createRoom(pageA, `Alice${suffix}tr`)
    await joinRoom(pageB, `Bob${suffix}tr`, roomCode)

    // Alice waits with a timed round and a single-book restriction.
    await pageA.getByRole('tab', { name: 'Books', exact: true }).click()
    const firstBook = pageA.locator('bg-book-selector .book').first()
    await expect(firstBook).toBeVisible()
    await firstBook.locator('input[type="checkbox"]').check()
    const chosenBook = (await firstBook.innerText()).trim()

    await pageA.getByRole('slider', { name: /Time per verse/ }).fill('30')
    await expect(pageA.locator('bg-challenge-settings .slider-value').last()).toHaveText('30s')

    await pageA.getByRole('button', { name: 'Play someone random' }).click()
    await expect(pageA.getByText(/waiting for another player/i)).toBeVisible()

    // Bob joins with no restriction and no time limit.
    await pageB.getByRole('button', { name: 'Play someone random' }).click()
    await expect(pageA.getByText(/Round 1 \//)).toBeVisible({ timeout: 10_000 })

    // The countdown proves the time limit survived. For the restriction,
    // a Books-scoped game gives the guess form a dropdown of exactly the
    // allowed books (a locked book is Chapters mode, not this), so Bob
    // seeing only Alice's chosen book proves her restriction applied.
    await expect(pageB.locator('bg-multiplayer-game')).toContainText(/\d+s/)

    const options = await pageB.locator('bg-guess-form select option').allInnerTexts()
    const books = options.map((o) => o.trim()).filter((o) => o !== '' && !/choose/i.test(o))
    expect(books).toEqual([chosenBook])
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
