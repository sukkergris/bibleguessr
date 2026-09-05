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

// Sets the challenge-settings time-per-verse slider to `seconds` before
// challenging — mirrors setRoundCount's own pattern/rationale exactly.
// `seconds` is the raw slider position, not necessarily the resulting
// timeLimitSeconds — see docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md's
// slider-clamp behavior (dragging to 1 lands on 2, since a genuinely
// 1-second round is degenerate) — callers testing that clamp should NOT
// use this helper's own assertion, since it'll fail on a value that gets
// remapped; drive the slider directly instead (see the clamp test below).
async function setTimeLimit(page: Page, seconds: number) {
  const slider = page.getByRole('slider', { name: /Time per verse/ })
  await slider.fill(String(seconds))
  await expect(page.locator('bg-challenge-settings .slider-value').last()).toHaveText(`${seconds}s`)
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
      // Generous timeout because each round's result is deliberately held
      // on screen for REVEAL_HOLD_MS (1.5s, see multiplayer-game.ts)
      // before the next round is allowed to replace it — so rounds 2 and
      // 3 arrive a beat after both guesses land, not immediately.
      await expect(pageA.getByText(`Round ${round} / 3`)).toBeVisible({ timeout: 10_000 })
      await submitGuess(pageA, 'Genesis')
      await submitGuess(pageB, 'Genesis')
    }

    // Same REVEAL_HOLD_MS beat as inside the loop above — the FINAL
    // round's reveal is held too, before the results screen replaces it.
    await expect(pageA.locator('bg-multiplayer-results')).toBeVisible({ timeout: 10_000 })
    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible({ timeout: 10_000 })

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

test('leaving mid-game via Forfeit uses the custom confirmation dialog', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
    const aliceName = `Alice${suffix}f`;
    const bobName = `Bob${suffix}f`;

    await joinWorldChat(pageA, aliceName);
    await joinWorldChat(pageB, bobName);

    const bobInRoster = pageA
      .getByRole('listitem')
      .filter({ hasText: bobName });
    await bobInRoster.click();

    const requestOnBobsScreen = pageB
      .getByRole('listitem')
      .filter({ hasText: `${aliceName} wants to play` });
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click();

    await expect(pageA.getByText('Round 1 /')).toBeVisible();

    await pageA.getByRole('button', { name: 'Forfeit' }).click();
    const forfeitDialog = pageA.getByRole('dialog', { name: 'Forfeit game?' });
    await expect(forfeitDialog).toBeVisible();
    await forfeitDialog
      .getByRole('button', { name: 'Forfeit', exact: true })
      .click();

    // Once forfeited, the server's GameOver reaches Bob too.
    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

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

    // Generous timeout: each round's result is held on screen for
    // REVEAL_HOLD_MS (1.5s, see multiplayer-game.ts) before the next
    // round replaces it, so round 2 arrives a beat after both guesses.
    await expect(pageA.getByText('Round 2 /')).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByText('Round 2 /')).toBeVisible({ timeout: 10_000 })
    await expect(pageA.locator('.scoreboard')).not.toContainText(': 0')
    await expect(pageB.locator('.scoreboard')).not.toContainText(': 0')
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// See docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md — a player who
// doesn't submit a guess before the round's time limit elapses sees
// "Choked!" in the reveal, and so does their opponent (the reveal always
// shows both players' outcomes to both sides — see
// multiplayer-game.ts's _renderRoundReveal doc comment). The reveal is
// also held on screen for a real, fixed minimum duration (REVEAL_HOLD_MS,
// 1.5s) before the next round replaces it — without this, the server
// broadcasts RoundScored and the following RoundStarted back-to-back
// with no gap, so the reveal would otherwise flash for well under 100ms
// in practice: long enough to be technically present, nowhere near long
// enough for a player to actually read it.
test('a player who never guesses sees "Choked!" for themself, and their opponent sees it too, held for a real minimum duration', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}c`
    const bobName = `Bob${suffix}c`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await setRoundCount(pageA, 3)
    await setTimeLimit(pageA, 2)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // Alice guesses; Bob deliberately never does — only the
    // RoundTimeoutService sweep (1s default interval) will ever resolve
    // this round once the 2s limit elapses.
    await submitGuess(pageA, 'Genesis')

    const revealSeenAt = Date.now()
    await expect(pageA.getByText('Choked!')).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByText('Choked!')).toBeVisible({ timeout: 10_000 })

    // Confirm the hold is real, not just "eventually true" — round 2
    // must NOT have started yet immediately after the reveal appears
    // (comfortably before the 1.5s hold could have elapsed).
    await expect(pageA.getByText('Round 2 /')).not.toBeVisible()

    // ...but round 2 DOES start once the hold expires — proving this
    // isn't stuck forever, just delayed.
    await expect(pageA.getByText('Round 2 /')).toBeVisible({ timeout: 5_000 })
    expect(Date.now() - revealSeenAt).toBeGreaterThanOrEqual(1_400) // small margin below the real 1500ms
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('the screen blinks in the final 7 seconds of a timed round, and stops once it resolves', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}b`
    const bobName = `Bob${suffix}b`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    // 15s: the danger window is the final 7s, so this leaves ~8s of
    // "definitely not blinking yet" for the assertion below AND a full
    // 7s of blinking after. Earlier values (8s, then 12s) left too
    // little margin on the leading edge — round-start latency under
    // parallel load could eat it, which caused this test's intermittent
    // failures.
    await setTimeLimit(pageA, 15)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // No blink yet — still well above the 7s threshold this early in a
    // 12s round.
    await expect(pageA.locator('body')).not.toHaveClass(/countdown-danger/)

    // Wait for the countdown to fall to 7s or fewer, then confirm the
    // class appears. Neither player guesses, so the round resolves via
    // the timeout sweep once the limit elapses, at which point the class
    // must clear again (the reveal has no countdown to be urgent about).
    await expect(pageA.locator('body')).toHaveClass(/countdown-danger/, { timeout: 15_000 })
    // Then assert the class CLEARS, directly — rather than first waiting
    // on the "Choked!" reveal as a proxy for "the round ended". That
    // reveal only stays up for REVEAL_HOLD_MS (1.5s) before the next
    // round replaces it, so waiting on it made this test fail under load
    // on a timing artifact rather than on the behavior under test. The
    // budget must still exceed the round's own 12s limit plus the
    // server's ~1s timeout-sweep interval.
    await expect(pageA.locator('body')).not.toHaveClass(/countdown-danger/, { timeout: 20_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('a round at or below the blink threshold never triggers the blink', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}n`
    const bobName = `Bob${suffix}n`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    // 2s is the slider's actual minimum reachable timed value (see
    // docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md's slider clamp).
    // Any round at or below MIN_BLINKABLE_ROUND_SECONDS (7s — equal to
    // the danger window itself, see multiplayer-game.ts) would otherwise
    // be entirely "final countdown" from its first instant and blink
    // start to finish, so it must never blink at all.
    await setTimeLimit(pageA, 2)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // Watch the class itself for the whole round rather than waiting on
    // the "Choked!" reveal as a proxy for "the round finished": that
    // reveal is only guaranteed on screen for REVEAL_HOLD_MS (1.5s)
    // before the next round replaces it, so under load a slow check can
    // miss the window entirely and fail on a timing artifact rather than
    // on the behavior under test. The class is the actual subject here,
    // and polling it directly can't miss a transient.
    const roundEndsBy = Date.now() + 8_000
    while (Date.now() < roundEndsBy) {
      const blinking = await pageA.locator('body').evaluate((el) => el.classList.contains('countdown-danger'))
      expect(blinking, 'a round at or below the blink threshold must never blink').toBe(false)
      await pageA.waitForTimeout(100)
    }
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('the time-per-verse slider clamps 1 second up to 2', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    await joinWorldChat(pageA, `Alice${suffix}s`)

    const slider = pageA.getByRole('slider', { name: /Time per verse/ })
    await slider.fill('1')

    await expect(pageA.locator('bg-challenge-settings .slider-value').last()).toHaveText('2s')
  } finally {
    await ctxA.close()
  }
})

test('checking "Enter epilepsy-inducing stress mode" pushes the blink past the default safe cap, and stays local to the player who checked it', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}e`
    const bobName = `Bob${suffix}e`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    // Only Alice opts in — Bob's own screen should stay at the safe cap
    // regardless, since this is a local, per-player preference (see
    // flash-intensity-storage.ts), never sent to the server or shared
    // with the opponent.
    await pageA.getByRole('checkbox', { name: /Enter epilepsy-inducing stress mode/ }).check()
    // 15s so the 7s danger window opens a comfortable ~8s in, and stays
    // open for its full 7s. Shorter rounds (8s, then 10s) left too
    // little slack before the blink had to appear — round-start latency
    // under parallel load alone could eat it, which is what made this
    // test intermittently fail.
    await setTimeLimit(pageA, 15)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    await expect(pageA.locator('body')).toHaveClass(/countdown-danger/, { timeout: 15_000 })

    // Poll --countdown-danger-speed while the danger window is live and
    // track the FASTEST (lowest) value each page ever reaches — a fixed
    // wait risks landing either too early (curves haven't diverged yet,
    // both near their shared 1s starting point) or too late (the round
    // has already resolved and the property was cleared — see
    // bg-app.ts's _onCountdownDangerChanged, which removes both custom
    // properties on the "leaving" edge specifically so a stale value
    // can't be read after the fact). Polling the whole window and
    // keeping the minimum sidesteps both failure modes.
    const readSpeedSeconds = async (page: typeof pageA) => {
      const raw = await page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue('--countdown-danger-speed').trim(),
      )
      const parsed = Number.parseFloat(raw.replace('s', ''))
      return Number.isNaN(parsed) ? undefined : parsed
    }

    // Poll until the danger window actually closes, bounded by wall
    // clock rather than an iteration count: a fixed 30×250ms budget
    // could expire while the window was still open (the window is the
    // final 7s of a 10s round, and this loop only starts once the class
    // appears), leaving both readings near their shared 1s starting
    // point where the two curves haven't diverged yet — which made the
    // comparison below a coin flip under load.
    let aliceFastest = Number.POSITIVE_INFINITY
    let bobFastest = Number.POSITIVE_INFINITY
    const pollUntil = Date.now() + 15_000
    while (Date.now() < pollUntil) {
      const [aliceSpeed, bobSpeed] = await Promise.all([readSpeedSeconds(pageA), readSpeedSeconds(pageB)])
      if (aliceSpeed !== undefined) aliceFastest = Math.min(aliceFastest, aliceSpeed)
      if (bobSpeed !== undefined) bobFastest = Math.min(bobFastest, bobSpeed)
      if (!(await pageA.locator('body').evaluate((el) => el.classList.contains('countdown-danger')))) break
      await pageA.waitForTimeout(250)
    }
    expect(aliceFastest, 'never sampled a live speed for Alice').toBeLessThan(Number.POSITIVE_INFINITY)
    expect(bobFastest, 'never sampled a live speed for Bob').toBeLessThan(Number.POSITIVE_INFINITY)

    // A direct relative comparison, not a fixed absolute number: the
    // server's ~1s timeout-sweep interval means the round can resolve
    // anywhere within that slop after the true 0s-remaining deadline, so
    // a 250ms poll isn't guaranteed to ever catch a reading at the exact
    // theoretical minimum (0.34s safe / 0.1s stress) before the property
    // is cleared — but it reliably catches BOTH curves diverging well
    // before that point (see the safe-vs-stress table this feature's
    // design was verified against: at 1s remaining alone, safe=0.56s vs
    // stress=0.39s, already a clear gap). Alice (opted in) must be
    // reliably faster than Bob (never touched the setting) by then —
    // that relationship is what "stays local to the player who checked
    // it" actually means, and it's what's robust to test, not the exact
    // endpoint value.
    expect(aliceFastest).toBeLessThan(bobFastest)
    // Bob never opted in, so he must never go below the safe floor —
    // BLINK_CYCLE_FASTEST_SECONDS_SAFE in multiplayer-game.ts.
    expect(bobFastest).toBeGreaterThanOrEqual(0.45)
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// Regression test for a real bug: <bg-multiplayer-game>'s _onGameOver
// dispatched 'game-over' but never told bg-app.ts to stop the
// countdown blink. A normal Completed ending masked this — the round is
// already Scored by then, so _revealed is true and updated() has
// already reported active:false — but a Forfeited ending arrives
// mid-round, with the countdown still live and _revealed still false,
// so nothing ever cleared document.body's countdown-danger class and
// the whole screen kept blinking over the results screen.
test('the blink stops when the game ends by forfeit mid-countdown', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}fb`
    const bobName = `Bob${suffix}fb`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    // Comfortably above MIN_BLINKABLE_ROUND_SECONDS so the round DOES
    // blink, but long enough that the forfeit below lands while the
    // countdown is still running rather than after it has expired.
    await setTimeLimit(pageA, 10)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // Wait until the blink is genuinely running on Bob's screen (the
    // player who will REMAIN — he's the one whose screen must recover).
    await expect(pageB.locator('body')).toHaveClass(/countdown-danger/, { timeout: 20_000 })

    // The custom in-app dialog replaced the native confirm() (see
    // docs/SCRUM/Feature.Forfeit.md) — click through it rather than
    // auto-accepting a browser dialog that no longer appears.
    await pageA.getByRole('button', { name: 'Forfeit' }).click()
    await pageA
      .getByRole('dialog', { name: 'Forfeit game?' })
      .getByRole('button', { name: 'Forfeit', exact: true })
      .click()

    // Bob reaches the results screen — and his screen must stop blinking.
    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible()
    await expect(pageB.locator('body')).not.toHaveClass(/countdown-danger/)
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// Regression test for a real bug: <bg-play-requests> cached each
// request's resolved game-type description keyed ONLY by fromPlayerId,
// and never invalidated that cache. The first request from a given
// player therefore "stuck" — a later request from the SAME player with
// a different game type kept showing the first one's description. In
// practice that meant a Books/Chapters challenge kept displaying the
// unrestricted-game text cached from an earlier unrestricted request.
test('a Books-scoped play request shows the actual books, not a stale unrestricted description', async ({
  browser,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}gt`
    const bobName = `Bob${suffix}gt`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    // First: an all-verses request, which Bob denies. This is what
    // populates the stale cache entry under Alice's player id.
    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()

    const firstRequest = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    // The challenged player sees everything they're agreeing to: which
    // verses, how many rounds, and how long per verse.
    await expect(firstRequest).toContainText('The Bible')
    await expect(firstRequest).toContainText('rounds')
    await expect(firstRequest).toContainText('No time limit')
    await firstRequest.getByRole('button', { name: 'Deny' }).click()
    await expect(firstRequest).toBeHidden()

    // Now Alice picks a specific book and challenges again. Bob must see
    // THAT book, not the "The Bible" text cached from the denied request.
    await pageA.getByRole('tab', { name: 'Books', exact: true }).click()
    const firstBook = pageA.locator('bg-book-selector .book').first()
    await expect(firstBook).toBeVisible()
    await firstBook.locator('input[type="checkbox"]').check()
    const chosenBook = (await firstBook.innerText()).trim()

    await bobInRoster.click()

    const secondRequest = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await expect(secondRequest).toBeVisible()
    await expect(secondRequest).toContainText(chosenBook)
    await expect(secondRequest).not.toContainText('The Bible')
    await expect(secondRequest).toContainText('Books:')
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// The opponent must reach the results screen when a forfeit arrives
// while their own screen is mid reveal-hold (see REVEAL_HOLD_MS in
// multiplayer-game.ts) — the hold buffers a Completed GameOver by
// design, and this pins down that a Forfeited one still cuts through.
test('the opponent still reaches results when a forfeit lands during a reveal hold', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}fh`
    const bobName = `Bob${suffix}fh`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await setRoundCount(pageA, 5)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()
    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageA.getByText('Round 1 / 5')).toBeVisible({ timeout: 10_000 })

    // Both guess, which scores the round and starts the 1.5s hold on
    // both screens. Alice forfeits immediately, inside that window.
    await submitGuess(pageA, 'Genesis')
    await submitGuess(pageB, 'Genesis')

    // The custom in-app dialog replaced the native confirm() (see
    // docs/SCRUM/Feature.Forfeit.md) — click through it rather than
    // auto-accepting a browser dialog that no longer appears.
    await pageA.getByRole('button', { name: 'Forfeit' }).click()
    await pageA
      .getByRole('dialog', { name: 'Forfeit game?' })
      .getByRole('button', { name: 'Forfeit', exact: true })
      .click()

    await expect(pageB.locator('bg-multiplayer-results')).toBeVisible({ timeout: 10_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// Same as the Forfeit-button case but from the ACCEPTING player's side —
// Bob accepted the challenge, then forfeits; Alice must reach results.
test('the challenger reaches results when the accepting player forfeits', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}fa`
    const bobName = `Bob${suffix}fa`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)

    const bobInRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInRoster.click()
    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()

    await expect(pageB.getByText('Round 1 /')).toBeVisible()

    // The custom in-app dialog replaced the native confirm() (see
    // docs/SCRUM/Feature.Forfeit.md) — click through it rather than
    // auto-accepting a browser dialog that no longer appears.
    await pageB.getByRole('button', { name: 'Forfeit' }).click()
    await pageB
      .getByRole('dialog', { name: 'Forfeit game?' })
      .getByRole('button', { name: 'Forfeit', exact: true })
      .click()

    await expect(pageA.locator('bg-multiplayer-results')).toBeVisible({ timeout: 10_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// A player already in a game must not be offerable as a challenge
// target. The backend already refuses this ("That player is already in
// a game" — see GameHub.fs's SendPlayRequest guard), but the roster used
// to still present them as clickable, so the only feedback was an error
// after the fact. RoundStarted/GameOver are both broadcast to the whole
// room group and carry both player ids, so every client can track who's
// busy without any extra backend payload.
test('a player already in a game is shown as busy and cannot be challenged', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const ctxC = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  const pageC = await ctxC.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}bz`
    const bobName = `Bob${suffix}bz`
    const carolName = `Carol${suffix}bz`

    await joinWorldChat(pageA, aliceName)
    await joinWorldChat(pageB, bobName)
    await joinWorldChat(pageC, carolName)

    // Alice and Bob start a game; Carol watches from the lobby.
    const bobInAlicesRoster = pageA.getByRole('listitem').filter({ hasText: bobName })
    await bobInAlicesRoster.click()
    const requestOnBobsScreen = pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` })
    await requestOnBobsScreen.getByRole('button', { name: 'Accept' }).click()
    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    // On Carol's screen both of them must now read as busy/unavailable.
    const aliceInCarolsRoster = pageC.getByRole('listitem').filter({ hasText: aliceName })
    const bobInCarolsRoster = pageC.getByRole('listitem').filter({ hasText: bobName })
    await expect(aliceInCarolsRoster).toContainText(/in a game/i, { timeout: 10_000 })
    await expect(bobInCarolsRoster).toContainText(/in a game/i)

    // And Carol must not be able to send them a request at all.
    await aliceInCarolsRoster.click()
    await expect(pageA.getByText(`${carolName} wants to play`)).toBeHidden()
  } finally {
    await ctxA.close()
    await ctxB.close()
    await ctxC.close()
  }
})

