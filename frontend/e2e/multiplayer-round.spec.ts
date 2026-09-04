import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Exercises the synced multiplayer round-sync feature end-to-end — see
// the "Multiplayer Game: Round Sync" plan — with two independent browser
// contexts standing in for two separate players/browsers hitting the same
// live server. Requires both dev servers already running — see
// playwright.config.ts and README.md's "Running tests" section.

// Returns the translation this page ended up selecting for itself (the
// server-translation dropdown's first option, auto-selected once loaded)
// — the translation picker only exists on this pre-join "choose" screen
// (see bg-room-setup.ts), not inside the room, so callers that need to
// know a page's own choice (e.g. to compare it against that page's later
// /api/verses/lookup requests) must capture it here.
async function joinWorldChat(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  // The server-translation dropdown auto-selects its first option once
  // loaded — wait for that (rather than a fixed timeout) before the name
  // field/Join button, which are disabled until a translation is chosen
  // (see docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation
  // note: this happens before the name field, not after).
  const translationField = page.getByRole('combobox', { name: 'Translation' })
  await expect(translationField).not.toHaveValue('')
  const translation = await translationField.inputValue()
  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
  return translation
}

// Joins World chat using an UPLOADED Bible file instead of the server
// translation — fixtures/genesis1-full.zip spells its one book "Genesis",
// a genuinely different spelling than the server's own bibelen-dk pool
// ("1.Mosebog"), with all 31 of Genesis chapter 1's real verses (matching
// bibelen-dk's own count) so any verse the server randomly picks within
// that chapter is guaranteed to exist here too. This is the exact
// real-world scenario that used to break: the round's VerseReference came
// from the server's pool (spelled "1.Mosebog"), and this player's own
// file has no book called that — only book-NUMBER-based resolution (see
// book-numbers.ts) fixes it, since both sources put Genesis at position 1
// regardless of spelling.
async function joinWorldChatWithUploadedFile(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await page.getByRole('tab', { name: 'My own Bible file' }).click()

  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures/genesis1-full.zip'))
  await expect(page.getByText(/^✓ Using/)).toBeVisible({ timeout: 10_000 })

  await page.getByPlaceholder('e.g. Alice').fill(name)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
}

// Sets the challenge-settings round-count slider to `rounds` before
// challenging — the sliders default to 5 rounds / no time limit, which
// makes a full-game e2e test slow; dialing rounds down keeps it fast.
async function setRoundCount(page: Page, rounds: number) {
  const slider = page.getByRole('slider', { name: /Number of rounds/ })
  await slider.fill(String(rounds))
  // Confirm the visible round-count label (a sibling <span>, driven by
  // bg-room-setup.ts's challengeSettings state via the
  // challenge-settings-changed event) has actually caught up before the
  // caller proceeds to challenge someone — under heavy parallel load the
  // input event's Lit re-render can lag behind slider.fill() resolving,
  // and this is the actual state a challenge is built from, not just the
  // <input>'s own DOM value.
  await expect(page.locator('bg-challenge-settings .slider-value').first()).toHaveText(String(rounds))
}

async function submitGuess(page: Page, book: string) {
  const bookField = page.getByLabel('Book')
  await bookField.fill(book)
  await page.getByRole('button', { name: 'Guess' }).click()
}

test('accepting a play request starts a synced round with the same verse for both players', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}r`
    const bobName = `Bob${suffix}r`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await expect(bobInRoster).toBeVisible()
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await expect(requestOnBobsScreen).toBeVisible()
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    // Both players land on the round view (chat/play-requests gone),
    // showing the same round number and the same verse text.
    await expect(pageA.getByText('Round 1 /')).toBeVisible()
    await expect(pageB.getByText('Round 1 /')).toBeVisible()

    const verseTextA = await pageA.locator('bg-verse-card .text').innerText()
    const verseTextB = await pageB.locator('bg-verse-card .text').innerText()
    expect(verseTextA).toBe(verseTextB)
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('each player resolves the round verse from their OWN chosen translation, not the server or the opponent', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}t`
    const bobName = `Bob${suffix}t`

    // Every /api/verses/lookup request each page makes to resolve a
    // round's bare VerseReference into displayable text — see
    // multiplayer-game.ts's _resolveCurrentVerse and
    // docs/SCRUM/Feature.RequestToStartMPGame.md's per-player-translation
    // note ("they don't need to choose identically"). Recording these
    // (rather than just checking rendered text, which would pass even if
    // the server smuggled text over the wire and the client just
    // displayed it) proves EACH player's client independently resolves
    // the verse using its OWN `translation` query param.
    const lookupTranslationsA: (string | null)[] = []
    const lookupTranslationsB: (string | null)[] = []
    pageA.on('request', (req) => {
      if (req.url().includes('/api/verses/lookup')) {
        lookupTranslationsA.push(new URL(req.url()).searchParams.get('translation'))
      }
    })
    pageB.on('request', (req) => {
      if (req.url().includes('/api/verses/lookup')) {
        lookupTranslationsB.push(new URL(req.url()).searchParams.get('translation'))
      }
    })

    // This dev environment only ships one server translation, so these
    // will be equal in practice; the point of this test is that each
    // page's OWN selection (whatever it is) is what its own lookup calls
    // use later, not a shared/opponent's value.
    const translationA = await joinWorldChat(pageA, aliceName)
    const translationB = await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()
    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()
    await expect(pageB.getByText('Round 1 /')).toBeVisible()

    // Wait for at least one lookup on each page (the round's own resolve).
    await expect.poll(() => lookupTranslationsA.length).toBeGreaterThan(0)
    await expect.poll(() => lookupTranslationsB.length).toBeGreaterThan(0)

    // Each page's lookup requests all carry THAT page's own translation
    // choice — never undefined/empty, never swapped with the other page's.
    expect(lookupTranslationsA.every((t) => t === translationA)).toBe(true)
    expect(lookupTranslationsB.every((t) => t === translationB)).toBe(true)

    // And the server itself was never asked to hand back text server-side
    // — every lookup is a request FROM the client, scoped to that client's
    // own choice; there is no endpoint that pushes verse text unprompted.
    // (RoundStarted's payload carries only book/chapter/verseNumber — see
    // types.ts's RoundState and multiplayer-game.ts's class doc comment —
    // so the very fact each page had to issue its OWN lookup at all, with
    // its OWN translation, is what this test is confirming.)
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('both players guessing auto-advances the round without either clicking anything', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}a`
    const bobName = `Bob${suffix}a`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await setRoundCount(pageA, 3)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 / 3')).toBeVisible()
    await expect(pageB.getByText('Round 1 / 3')).toBeVisible()

    await submitGuess(pageA, 'Genesis')
    await expect(pageA.getByText(`Guess locked in`)).toBeVisible()

    await submitGuess(pageB, 'Genesis')

    // Once both have guessed, the server resolves the round and advances
    // — both pages move on to round 2 without any "Next" click.
    await expect(pageA.getByText('Round 2 / 3')).toBeVisible()
    await expect(pageB.getByText('Round 2 / 3')).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('a full short game reaches the multiplayer results screen with matching final scores', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}g`
    const bobName = `Bob${suffix}g`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await setRoundCount(pageA, 3)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    for (let round = 1; round <= 3; round++) {
      await expect(pageA.getByText(`Round ${round} / 3`)).toBeVisible()
      await submitGuess(pageA, 'Genesis')
      await submitGuess(pageB, 'Genesis')
    }

    await expect(pageA.locator('bg-multiplayer-results')).toBeVisible()
    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible()

    // Each page labels the two rows "me" vs. the opponent's name — the
    // labels differ between pages (Alice's page shows "Alice: N / Bob: M",
    // Bob's shows "Bob: M / Alice: N"), so compare the two totals as an
    // unordered pair rather than the raw row text, which would never
    // match between pages even when both agree on the actual scores.
    const scoresOf = async (page: Page) => {
      const text = await page.locator('bg-multiplayer-results .tally').innerText()
      return text
        .split('\n')
        .map((line) => Number(line.match(/(\d+)\s*$/)?.[1]))
        .filter((n): n is number => !Number.isNaN(n))
        .sort((a, b) => a - b)
    }
    expect(await scoresOf(pageA)).toEqual(await scoresOf(pageB))

    await pageA.getByRole('button', { name: 'Back to room' }).click()
    await expect(pageA.locator('bg-multiplayer-results')).not.toBeVisible()
    await expect(pageA.getByRole('heading', { name: 'World chat' })).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('opponent tab closing mid-game shows a disconnected indicator', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}p`
    const bobName = `Bob${suffix}p`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // Bob's tab closes — Alice should see a prominent "connection dropped"
    // banner immediately (see docs/SCRUM/Feature.ConsiderTimeoutForDisconectedPlayers.md's
    // "did they actually leave, or is it just lag?" concern — no wait
    // needed to know something changed). The real 2-minute grace-period
    // forfeit isn't driven here (that would mean an actual 2-minute wait
    // in CI) — it's covered by the backend's RoomActiveGameTests.fs
    // instead, same pattern as player-presence.spec.ts.
    await ctxB.close()

    await expect(pageA.getByText(`${bobName}'s connection dropped.`)).toBeVisible()
  } finally {
    await ctxA.close()
  }
})

test('leaving mid-game via Forfeit prompts a confirm dialog', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}f`
    const bobName = `Bob${suffix}f`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    let dialogSeen = false
    pageA.once('dialog', (dialog) => {
      dialogSeen = true
      void dialog.accept()
    })
    await pageA.getByRole('button', { name: 'Forfeit' }).click()

    await expect.poll(() => dialogSeen).toBe(true)

    // Once forfeited, the server's GameOver reaches Bob too.
    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// Regression test for a real bug: GameHub.LeaveRoom (and the disconnect
// sweep after the grace period) broadcasts PlayerLeft BEFORE GameOver for
// the same forfeit. <bg-multiplayer-game> used to react to the opponent's
// PlayerLeft by firing a purely-local 'game-ended' teardown (meant only
// for "I clicked leave myself", not "my opponent left") — which won the
// race against the GameOver that was about to show the results screen,
// silently bouncing the remaining player back to the lobby with no
// summary at all. Fixed by having <bg-multiplayer-game> stop reacting to
// the opponent's PlayerLeft altogether — every path that removes a player
// mid-game (voluntary leave, stale-disconnect sweep, same-name-rejoin
// replacement) always pairs PlayerLeft with GameOver(Forfeited), so
// GameOver alone is a reliable, sole signal for "the game just ended."
test('the remaining player still reaches the results screen when the opponent leaves via Home mid-game', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}h`
    const bobName = `Bob${suffix}h`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageB.getByText('Round 1 /')).toBeVisible()

    // Alice leaves via "← Home" — not Forfeit — which calls the server's
    // LeaveRoom (broadcasting PlayerLeft then GameOver, in that order) the
    // instant it's clicked, no grace period involved.
    await pageA.getByRole('button', { name: '← Home' }).click()

    // Bob must still land on the results screen, not just get bounced back
    // to the normal room view.
    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('a player whose uploaded file spells a book differently than the server can still see and guess the round', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}u`
    const bobName = `Bob${suffix}u`

    // Alice: server translation (spells book 1 "1.Mosebog"). Bob: an
    // uploaded file (spells the same book "Genesis") — see
    // joinWorldChatWithUploadedFile's doc comment. Restricting the
    // challenge to book 1, chapter 1 (via the Chapters tab) forces every
    // round onto exactly the book whose spelling differs between them —
    // genesis1-full.zip's full 31-verse chapter 1 means any verse the
    // server randomly picks there is guaranteed to exist in Bob's file too.
    await joinWorldChat(pageA, aliceName)
    await joinWorldChatWithUploadedFile(pageB, bobName)

    await pageA.getByRole('tab', { name: 'Chapters' }).click()
    await pageA.getByLabel('Book').selectOption('1.Mosebog')
    await pageA.locator('.chapter', { hasText: '1' }).first().locator('input[type="checkbox"]').check()

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()
    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()
    await expect(pageB.getByText('Round 1 /')).toBeVisible()

    // The actual bug: Bob's own verse card must show real text from HIS
    // OWN file, not an "isn't in this file" error — and his guess form
    // must still be usable (not silently replaced by an error banner).
    await expect(pageB.locator('.verse-error')).not.toBeVisible()
    const verseTextB = await pageB.locator('bg-verse-card .text').innerText()
    expect(verseTextB.trim().length).toBeGreaterThan(0)
    await expect(pageB.locator('bg-guess-form')).toBeVisible()

    // The book is locked (Chapters-scope games commit to one book — see
    // guess-form.ts) to each player's OWN resolved spelling — Alice sees
    // "1.Mosebog", Bob sees "Genesis" — so there's no book field to type
    // into; just submit. A correct guess must still score as correct
    // server-side, proving the fix reaches scoring too (see
    // Scoring.isCorrectGuess), not just verse display — both players'
    // scores should be above zero once the round resolves.
    await expect(pageA.locator('.locked-book')).toHaveText('1.Mosebog')
    await expect(pageB.locator('.locked-book')).toHaveText('Genesis')
    await pageA.getByRole('button', { name: 'Guess' }).click()
    await pageB.getByRole('button', { name: 'Guess' }).click()

    await expect(pageA.getByText('Round 2 /')).toBeVisible()
    await expect(pageB.getByText('Round 2 /')).toBeVisible()
    await expect(pageA.locator('.scoreboard')).not.toContainText(': 0')
    await expect(pageB.locator('.scoreboard')).not.toContainText(': 0')
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
