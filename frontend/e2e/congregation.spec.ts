import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { auditA11y } from './helpers/a11y'

// The Congregation — a group game for a whole room, with a live spectator
// board anyone with the link can open. See docs/web/congregation.
//
// Assumes the server's default rules (at least 3 players, a 10-60 second
// time limit). Run the backend with Congregation__RevealSeconds=2 to keep
// these tests quick; the default 5-second reveal works too, just slower.

// Any book the bundled server translation actually has — see
// multiplayer-round.spec.ts.
const ANY_SERVER_BOOK = '1.Mosebog'
const TIME_LIMIT_SECONDS = 10
const ROUNDS = 3
const ROUND_TIMEOUT = 30_000

async function enterMultiplayer(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
}

async function createRoom(page: Page, name: string): Promise<string> {
  await enterMultiplayer(page, name)
  await page.getByRole('button', { name: 'Create a room' }).click()
  const code = page.locator('bg-room-setup h1 .code')
  await expect(code).toBeVisible()
  return (await code.innerText()).trim()
}

async function joinRoom(page: Page, name: string, roomCode: string) {
  await enterMultiplayer(page, name)
  await page.getByPlaceholder('Room code').fill(roomCode)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.locator('bg-room-setup h1 .code')).toHaveText(roomCode)
}

async function submitGuess(page: Page) {
  await page.locator('bg-guess-form').getByRole('radio', { name: ANY_SERVER_BOOK }).check()
  await page.getByRole('button', { name: 'Guess' }).click()
}

interface Room {
  code: string
  host: Page
  players: Page[]
  /** The players' names, in the same order as `players`. */
  names: string[]
  contexts: BrowserContext[]
}

/** A private room with a host and `others` more players in it. */
async function roomWith(browser: Browser, others: string[]): Promise<Room> {
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
  const contexts = await Promise.all([undefined, ...others].map(() => browser.newContext()))
  const pages = await Promise.all(contexts.map((c) => c.newPage()))
  const names = others.map((name) => `${name}${suffix}`)
  const code = await createRoom(pages[0], `Host${suffix}`)
  for (const [i, name] of names.entries()) await joinRoom(pages[i + 1], name, code)
  return { code, host: pages[0], players: pages.slice(1), names, contexts }
}

async function openLobby(host: Page) {
  await host.getByRole('slider', { name: /Number of rounds/ }).fill(String(ROUNDS))
  await host.getByRole('slider', { name: /Time per verse/ }).fill(String(TIME_LIMIT_SECONDS))
  await host.getByRole('button', { name: 'Host a Congregation' }).click()
  await expect(host.getByRole('heading', { name: 'Congregation' })).toBeVisible()
}

async function joinLobby(page: Page) {
  await page.getByRole('button', { name: 'Join the Congregation' }).click()
  await expect(page.getByText(/You're in/)).toBeVisible()
}

test('three players play a Congregation while a spectator watches without seeing the verse early', async ({
  browser,
}) => {
  const room = await roomWith(browser, ['Ann', 'Ben'])
  const [ann, ben] = room.players
  const spectatorContext = await browser.newContext()
  const spectator = await spectatorContext.newPage()

  try {
    // Every WebSocket frame the spectator receives, to check nothing
    // reveals the round's reference before it is scored.
    const spectatorFrames: string[] = []
    spectator.on('websocket', (ws) => ws.on('framereceived', (frame) => spectatorFrames.push(String(frame.payload))))

    await spectator.goto(`/#/watch/${room.code}`)
    await expect(spectator.getByText('No Congregation yet.')).toBeVisible()

    await openLobby(room.host)
    await expect(spectator.getByText(/is gathering a Congregation/)).toBeVisible()

    // Two members are one short of the minimum.
    await joinLobby(ann)
    const start = room.host.getByRole('button', { name: 'Start the game' })
    await expect(start).toBeDisabled()
    await expect(room.host.getByText('Waiting for 1 more player to join.')).toBeVisible()

    await joinLobby(ben)
    await expect(start).toBeEnabled()
    await start.click()

    // Everyone sees the same verse — one shared game.
    for (const page of [room.host, ann, ben]) {
      await expect(page.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()
      await expect(page.locator('bg-verse-card .text')).toBeVisible()
    }
    const verseText = await room.host.locator('bg-verse-card .text').innerText()
    expect(await ann.locator('bg-verse-card .text').innerText()).toBe(verseText)
    expect(await ben.locator('bg-verse-card .text').innerText()).toBe(verseText)

    await expect(spectator.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()
    await expect(spectator.locator('bg-leaderboard-table tbody tr')).toHaveCount(3)

    // Nothing the spectator received so far names the verse.
    expect(spectatorFrames.join('\n')).not.toMatch(/bookNumber|verseNumber/i)

    // Everyone guesses, so the round resolves well before the timer.
    await submitGuess(room.host)
    await expect(room.host.getByText(/Guess locked in. 1 of 3 players have guessed./)).toBeVisible()
    await submitGuess(ann)
    await submitGuess(ben)

    await expect(room.host.getByText(/You scored \d+ points|You didn't guess/)).toBeVisible()
    // Now — and only now — the spectator shows which verse it was.
    await expect(spectator.locator('main .big')).toContainText(/Verse 1 of 3: .+ \d+:\d+/)
    expect(spectatorFrames.join('\n')).toMatch(/verseNumber/i)

    // Play out the remaining rounds by letting them all guess.
    for (let round = 2; round <= ROUNDS; round++) {
      for (const page of [room.host, ann, ben]) {
        await expect(page.getByText(`Verse ${round} of ${ROUNDS}`)).toBeVisible({ timeout: ROUND_TIMEOUT })
        await expect(page.locator('bg-guess-form')).toBeVisible()
        await submitGuess(page)
      }
    }

    for (const page of [room.host, ann, ben]) {
      await expect(page.getByRole('heading', { name: 'Final standings' })).toBeVisible({ timeout: ROUND_TIMEOUT })
    }
    await expect(spectator.getByText('The game is over.', { exact: true })).toBeVisible()
    await expect(spectator.getByRole('table', { name: 'Final leaderboard' })).toBeVisible()

    // Back in the room, it is free for duels again.
    await ann.getByRole('button', { name: 'Back to the room' }).click()
    await expect(ann.getByRole('button', { name: 'Play someone random' })).toBeVisible()
  } finally {
    await spectatorContext.close()
    for (const context of room.contexts) await context.close()
  }
})

test('a player who leaves mid-game stays on the leaderboard and the others play on', async ({ browser }) => {
  const room = await roomWith(browser, ['Ann', 'Ben'])
  const [ann, ben] = room.players

  try {
    await openLobby(room.host)
    await joinLobby(ann)
    await joinLobby(ben)
    await room.host.getByRole('button', { name: 'Start the game' }).click()
    await expect(ben.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()

    // The leave dialog: Escape closes it and gives focus back.
    const leave = ben.getByRole('button', { name: 'Leave the game' })
    await leave.click()
    await expect(ben.getByRole('dialog', { name: 'Leave the game?' })).toBeVisible()
    // Focus moves into the dialog, onto the safe choice.
    await expect(ben.getByRole('button', { name: 'Stay' })).toBeFocused()
    await ben.keyboard.press('Escape')
    await expect(ben.getByRole('dialog')).toBeHidden()
    await expect(leave).toBeFocused()

    await leave.click()
    await ben.getByRole('button', { name: 'Leave', exact: true }).click()
    await expect(ben.getByText('A Congregation is being played in this room.')).toBeVisible()

    // The two still playing are no longer waiting for Ben.
    await submitGuess(room.host)
    await submitGuess(ann)
    await expect(ann.getByText(/You scored \d+ points/)).toBeVisible()

    const benRow = ann.locator('bg-leaderboard-table tbody tr', { hasText: 'Ben' })
    await expect(benRow).toContainText('Left')
  } finally {
    for (const context of room.contexts) await context.close()
  }
})

// The guess form takes focus when a verse arrives. With the leave dialog
// open that must not pull focus out of the dialog — a modal keeps focus
// until it is closed. Holding Ben's verse back until his dialog is open
// makes that timing certain.
test('a verse arriving while the leave dialog is open does not take focus out of it', async ({ browser }) => {
  const room = await roomWith(browser, ['Ann', 'Ben'])
  const [ann, ben] = room.players

  try {
    let releaseVerse = () => {}
    const verseHeld = new Promise<void>((resolve) => (releaseVerse = resolve))
    await ben.route('**/api/verses/lookup?**', async (route) => {
      await verseHeld
      await route.continue()
    })

    await openLobby(room.host)
    await joinLobby(ann)
    await joinLobby(ben)
    await room.host.getByRole('button', { name: 'Start the game' }).click()
    await expect(ben.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()

    await ben.getByRole('button', { name: 'Leave the game' }).click()
    const stay = ben.getByRole('button', { name: 'Stay' })
    await expect(stay).toBeFocused()

    releaseVerse()
    await expect(ben.locator('bg-verse-card .text')).toBeVisible()
    await expect(ben.locator('bg-guess-form').getByRole('radio').first()).toBeAttached()

    await expect(stay).toBeFocused()
    await ben.keyboard.press('Escape')
    await expect(ben.getByRole('dialog')).toBeHidden()
  } finally {
    for (const context of room.contexts) await context.close()
  }
})

test('a round ends on the timer when someone never guesses', async ({ browser }) => {
  const room = await roomWith(browser, ['Ann', 'Ben'])
  const [ann, ben] = room.players

  try {
    await openLobby(room.host)
    await joinLobby(ann)
    await joinLobby(ben)
    await room.host.getByRole('button', { name: 'Start the game' }).click()

    await expect(ben.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()
    await submitGuess(room.host)
    await submitGuess(ann)
    // Ben never guesses.

    await expect(ben.getByText("You didn't guess this verse.")).toBeVisible({ timeout: ROUND_TIMEOUT })
    await expect(ben.locator('bg-leaderboard-table tbody tr', { hasText: 'Ben' })).toContainText('No guess')
  } finally {
    for (const context of room.contexts) await context.close()
  }
})

test('a player who reloads mid-game gets their seat and score back', async ({ browser }) => {
  const room = await roomWith(browser, ['Ann', 'Ben'])
  const [ann, ben] = room.players

  try {
    await openLobby(room.host)
    await joinLobby(ann)
    await joinLobby(ben)
    await room.host.getByRole('button', { name: 'Start the game' }).click()
    await expect(ben.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()

    // A reload drops the connection; rejoining under the same name takes
    // the seat back rather than counting as a new player.
    await ben.reload()
    await joinRoom(ben, room.names[1], room.code)

    await expect(ben.getByText(/Verse \d of 3/)).toBeVisible()
    await expect(ben.locator('bg-leaderboard-table tbody tr', { hasText: '(you)' })).toHaveCount(1)
    await expect(room.host.locator('bg-leaderboard-table tbody tr')).toHaveCount(3)
  } finally {
    for (const context of room.contexts) await context.close()
  }
})

test('while a Congregation has the room, nobody else can start a duel', async ({ browser }) => {
  const room = await roomWith(browser, ['Ann', 'Ben', 'Dan'])
  const [ann, ben, dan] = room.players

  try {
    await openLobby(room.host)

    // Dan hasn't joined the lobby, and still can't challenge or be matched.
    await expect(dan.getByRole('button', { name: 'Join the Congregation' })).toBeVisible()
    await expect(dan.getByRole('button', { name: 'Play someone random' })).toBeHidden()
    await expect(dan.locator('bg-chat-panel').getByRole('button', { name: /challenge to a game/ })).toHaveCount(0)

    await joinLobby(ann)
    await joinLobby(ben)
    await room.host.getByRole('button', { name: 'Start the game' }).click()

    await expect(dan.getByText('A Congregation is being played in this room.')).toBeVisible()
    await expect(dan.getByRole('link', { name: 'Watch the live leaderboard' })).toHaveAttribute(
      'href',
      new RegExp(`#/watch/${room.code}$`),
    )
  } finally {
    for (const context of room.contexts) await context.close()
  }
})

test('the host cannot open a Congregation without a time limit', async ({ browser }) => {
  const room = await roomWith(browser, [])

  try {
    await room.host.getByRole('slider', { name: /Time per verse/ }).fill('0')
    const host = room.host.getByRole('button', { name: 'Host a Congregation' })
    await expect(host).toBeDisabled()
    await expect(room.host.getByText('A Congregation needs a time limit. Choose one above.')).toBeVisible()
  } finally {
    for (const context of room.contexts) await context.close()
  }
})

test('the Congregation screens have no unlabeled controls', async ({ browser }) => {
  const room = await roomWith(browser, ['Ann', 'Ben'])
  const [ann, ben] = room.players
  const spectatorContext = await browser.newContext()
  const spectator = await spectatorContext.newPage()

  try {
    await openLobby(room.host)
    await joinLobby(ann)
    expect(await auditA11y(room.host)).toEqual([])
    expect(await auditA11y(ann)).toEqual([])

    await joinLobby(ben)
    await room.host.getByRole('button', { name: 'Start the game' }).click()
    await expect(ann.getByText(`Verse 1 of ${ROUNDS}`)).toBeVisible()
    expect(await auditA11y(ann)).toEqual([])

    await spectator.goto(`/#/watch/${room.code}`)
    await expect(spectator.getByRole('table', { name: 'Leaderboard' })).toBeVisible()
    expect(await auditA11y(spectator)).toEqual([])
  } finally {
    await spectatorContext.close()
    for (const context of room.contexts) await context.close()
  }
})
