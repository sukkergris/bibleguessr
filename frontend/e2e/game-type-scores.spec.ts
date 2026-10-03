import { test, expect, type Browser, type Page } from '@playwright/test'

// Scores follow the game type being played — see docs/web/scoring and
// scoring-scenarios/ at the repo root. Each game type has its own most a
// verse can earn (what's given at setup earns nothing), multiplayer scores
// a guess exactly like singleplayer, and the game a challenge sends is the
// game the room shows. Requires both dev servers already running — see
// playwright.config.ts.

// A book the bundled server translation has (its own spelling).
const SERVER_BOOK = 'Daniel'
const OTHER_SERVER_BOOK = '1.Mosebog'

type Setup = {
  name: string
  /** What is picked, for the test's title. */
  picked: string
  /** The most one verse can earn in this setup. */
  maxPointsPerVerse: number
  pick: (page: Page) => Promise<void>
  /** A guess the form accepts. */
  guess: (page: Page) => Promise<void>
}

async function tickBook(page: Page, book: string) {
  await page.locator('.book', { hasText: book }).first().locator('input[type="checkbox"]').check()
}

async function pickLoneChapter(page: Page) {
  await page.getByLabel('Book').selectOption(SERVER_BOOK)
  await page.locator('.chapter', { hasText: '1' }).first().locator('input[type="checkbox"]').check()
}

const guessAnyBook = async (page: Page) => {
  await page.locator('bg-guess-form').getByRole('radio', { name: SERVER_BOOK }).check()
  await page.getByRole('button', { name: 'Guess' }).click()
}
const guessAsOffered = (page: Page) => page.getByRole('button', { name: 'Guess' }).click()

const SETUPS: Setup[] = [
  { name: 'The Bible', picked: 'nothing to pick', maxPointsPerVerse: 1110, pick: async () => {}, guess: guessAnyBook },
  {
    name: 'Books',
    picked: 'two books',
    maxPointsPerVerse: 1110,
    pick: async (page) => {
      await tickBook(page, SERVER_BOOK)
      await tickBook(page, OTHER_SERVER_BOOK)
      await expect(page.getByText('2 books selected.')).toBeVisible()
    },
    guess: guessAnyBook,
  },
  {
    name: 'Books',
    picked: 'one book',
    maxPointsPerVerse: 1100,
    pick: async (page) => {
      await tickBook(page, SERVER_BOOK)
      await expect(page.getByText('1 book selected.')).toBeVisible()
    },
    guess: guessAsOffered,
  },
  {
    name: 'Chapters',
    picked: 'two chapters',
    maxPointsPerVerse: 1100,
    pick: async (page) => {
      await page.getByLabel('Book').selectOption(SERVER_BOOK)
      await page.locator('.chapter', { hasText: '1' }).first().locator('input[type="checkbox"]').check()
      await page.locator('.chapter', { hasText: '2' }).first().locator('input[type="checkbox"]').check()
    },
    guess: guessAsOffered,
  },
  { name: 'Chapters', picked: 'one chapter', maxPointsPerVerse: 1000, pick: pickLoneChapter, guess: guessAsOffered },
]

async function playToTheEnd(page: Page, guess: (page: Page) => Promise<void>) {
  await expect(page.locator('.round')).toContainText('Verse 1')
  while (!(await page.getByRole('button', { name: 'Play again' }).isVisible())) {
    await guess(page)
    await page.getByRole('button', { name: /Next verse|See results/ }).click()
  }
}

for (const setup of SETUPS) {
  test(`a ${setup.name} game with ${setup.picked} is counted out of ${setup.maxPointsPerVerse} a verse`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: setup.name, exact: false }).first().click()
    await setup.pick(page)
    await page.getByRole('button', { name: 'Start game' }).click()
    await playToTheEnd(page, setup.guess)

    const verses = await page.locator('bg-game-results .rounds li').count()
    expect(verses).toBeGreaterThan(0)
    await expect(page.locator('bg-game-results .max')).toHaveText(`/ ${verses * setup.maxPointsPerVerse}`)
  })
}

// A perfect game must reach exactly its own maximum — the "out of" and the
// points come from the same rule. The drawn verse is fixed so the guess
// can be perfect.
test('a perfect one-chapter Chapters game scores exactly its maximum', async ({ page }) => {
  await page.route('**/api/verses/random**', (route) =>
    route.fulfill({
      json: { book: SERVER_BOOK, chapter: 1, verseNumber: 1, text: 'A fixed verse.', translation: 'fixed', reference: `${SERVER_BOOK} 1:1` },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Chapters' }).click()
  await pickLoneChapter(page)
  await page.getByRole('button', { name: 'Start game' }).click()
  await playToTheEnd(page, async (page) => {
    const verse = page.locator('bg-guess-form').getByRole('slider', { name: 'Verse (optional)' })
    await expect(verse).toBeEnabled()
    await verse.fill('1')
    await page.getByRole('button', { name: 'Guess' }).click()
    await expect(page.locator('.feedback')).toContainText('+1000 points')
  })

  const verses = await page.locator('bg-game-results .rounds li').count()
  await expect(page.locator('bg-game-results .total')).toHaveText(`${verses * 1000} / ${verses * 1000}`)
})

// With one book picked in Books, the book is as given as a Chapters
// game's fixed book: chosen from the start, worth nothing on its own, and
// left out of a shared result.
test('a lone picked book is given: chosen from the start, and alone it earns nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: ShareData[] = []
    ;(window as unknown as { shared: ShareData[] }).shared = shared
    navigator.share = async (data?: ShareData) => {
      if (data) shared.push(data)
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Books' }).first().click()
  await tickBook(page, SERVER_BOOK)
  await page.getByRole('button', { name: 'Start game' }).click()

  const form = page.locator('bg-guess-form')
  await expect(form.getByRole('radio', { name: SERVER_BOOK })).toBeChecked()
  await expect(form.getByRole('slider', { name: 'Chapter (optional)' })).toBeEnabled()

  await playToTheEnd(page, async (page) => {
    await guessAsOffered(page)
    await expect(page.locator('.feedback')).toContainText('No points')
  })

  await page.getByRole('button', { name: 'Share result' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared.length)).toBe(1)
  const text = await page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared[0].text ?? '')
  expect(text.split('\n')[2]).toBe('Chapter · Verse')
})

// --- Multiplayer -----------------------------------------------------------

async function enterRoom(page: Page, name: string, roomCode?: string): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
  if (roomCode === undefined) {
    await page.getByRole('button', { name: 'Create a room' }).click()
  } else {
    await page.getByPlaceholder('Room code').fill(roomCode)
    await page.getByRole('button', { name: 'Join', exact: true }).click()
  }
  const code = page.locator('bg-room-setup h1 .code')
  await expect(code).toBeVisible()
  return (await code.innerText()).trim()
}

/** `rememberedRoundCount`: what Alice's browser remembers from an earlier
 * game (see game-preferences.ts). */
async function twoPlayersInARoom(browser: Browser, rememberedRoundCount?: number) {
  const contexts = [await browser.newContext(), await browser.newContext()]
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()))
  if (rememberedRoundCount !== undefined) {
    await pageA.addInitScript(
      (count) => localStorage.setItem('bibleguessr:preferences:roundCount:v1', String(count)),
      rememberedRoundCount,
    )
  }
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
  const alice = `Alice${suffix}s`
  const bob = `Bob${suffix}s`
  const roomCode = await enterRoom(pageA, alice)
  await enterRoom(pageB, bob, roomCode)
  await expect(pageA.getByRole('listitem').filter({ hasText: bob })).toBeVisible()
  return { pageA, pageB, alice, bob, close: () => Promise.all(contexts.map((context) => context.close())) }
}

async function pickLoneChapterToChallenge(page: Page) {
  await page.getByRole('tab', { name: 'Chapters' }).click()
  await page.getByLabel('Book').selectOption(OTHER_SERVER_BOOK)
  await page.locator('.chapter', { hasText: '1' }).first().locator('input[type="checkbox"]').check()
}

async function setRoundCount(page: Page, rounds: number) {
  await page.getByRole('slider', { name: /Number of rounds/ }).fill(String(rounds))
  await expect(page.locator('bg-challenge-settings .slider-value').first()).toHaveText(String(rounds))
}

/** Picks the round's actual verse number — the chapter is preselected,
 * and 1.Mosebog 1 is complete, so slider position = verse number. */
async function pickTheVerse(page: Page) {
  // The round's own reference, there as soon as the round is — unlike the
  // verse text, which is still being looked up.
  const verseNumber = await page
    .locator('bg-multiplayer-game')
    .evaluate(
      (game) =>
        (game as unknown as { session: { round: { Fields: [{ verseNumber: number }] } } }).session.round.Fields[0]
          .verseNumber,
    )
  await expect(page.locator('bg-guess-form').getByRole('slider', { name: 'Verse (optional)' })).toBeEnabled()
  await page.locator('bg-guess-form').getByRole('slider', { name: 'Verse (optional)' }).fill(String(verseNumber))
}

test('multiplayer scores a guess like singleplayer: what is given earns nothing', async ({ browser }) => {
  const { pageA, pageB, alice, bob, close } = await twoPlayersInARoom(browser)
  try {
    await pickLoneChapterToChallenge(pageA)
    await setRoundCount(pageA, 3)
    await pageA.getByRole('listitem').filter({ hasText: bob }).click()
    await pageB.getByRole('listitem').filter({ hasText: `${alice} wants to play` }).getByRole('button', { name: 'Accept' }).click()
    await expect(pageA.getByText('Round 1 /')).toBeVisible()
    await expect(pageB.getByText('Round 1 /')).toBeVisible()

    // Alice guesses only what the game gave her (the book and the lone
    // chapter); Bob gets the verse.
    await pickTheVerse(pageB)
    await pageA.getByRole('button', { name: 'Guess' }).click()
    await pageB.getByRole('button', { name: 'Guess' }).click()

    await expect(pageA.locator('.reveal')).toContainText('You: +0 points')
    await expect(pageA.locator('.reveal')).toContainText(`${bob}: +1000 points`)
    await expect(pageB.locator('.reveal')).toContainText('You: +1000 points')
    await expect(pageB.locator('.scoreboard .me')).toHaveText(`${bob}: 1000`)
  } finally {
    await close()
  }
})

// The room owns the challenge settings: the panel is created anew when the
// room screen comes back after a game, and must show what the next
// challenge will actually send — not a fresh "The Bible" while the
// previous game type is sent.
test('after a game, the room shows the game type a challenge will send', async ({ browser }) => {
  const { pageA, pageB, alice, bob, close } = await twoPlayersInARoom(browser)
  try {
    await pickLoneChapterToChallenge(pageA)
    await setRoundCount(pageA, 3)
    await pageA.getByRole('listitem').filter({ hasText: bob }).click()
    await pageB.getByRole('listitem').filter({ hasText: `${alice} wants to play` }).getByRole('button', { name: 'Accept' }).click()
    await expect(pageA.getByText('Round 1 /')).toBeVisible()

    await pageA.getByRole('button', { name: 'Forfeit' }).click()
    await pageA.getByRole('dialog', { name: 'Forfeit game?' }).getByRole('button', { name: 'Forfeit', exact: true }).click()
    await pageA.getByRole('button', { name: 'Back to room' }).click()
    await pageB.getByRole('button', { name: 'Back to room' }).click()

    await expect(pageA.getByRole('tab', { name: 'Chapters' })).toHaveAttribute('aria-selected', 'true')
    await expect(pageA.locator('bg-challenge-settings .slider-value').first()).toHaveText('3')

    await pageA.getByRole('listitem').filter({ hasText: bob }).click()
    await expect(pageB.getByRole('listitem').filter({ hasText: `${alice} wants to play` })).toContainText(
      `Chapters: ${OTHER_SERVER_BOOK} 1 · 3 rounds`,
    )
  } finally {
    await close()
  }
})

// Remembered preferences are shown when the room opens — and must be what
// is sent, without touching a slider first.
test('a challenge sends the remembered round count the room shows', async ({ browser }) => {
  const { pageA, pageB, alice, bob, close } = await twoPlayersInARoom(browser, 4)
  try {
    await expect(pageA.locator('bg-challenge-settings .slider-value').first()).toHaveText('4')

    await pageA.getByRole('listitem').filter({ hasText: bob }).click()
    await expect(pageB.getByRole('listitem').filter({ hasText: `${alice} wants to play` })).toContainText('4 rounds')
  } finally {
    await close()
  }
})
