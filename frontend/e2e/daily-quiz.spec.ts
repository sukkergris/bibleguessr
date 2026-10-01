import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The daily quiz, played from Social — see docs/web/daily-quiz. The
// server's random pick is replaced by a fixed quiz here (real bibelen-dk
// verses, looked up through the real backend), so the answers are known.
// How the server makes, stores and keeps a day's quiz is covered by
// backend/Tests/DailyQuiz*Tests.fs.

const FIXED_QUIZ = {
  date: '2026-10-01',
  verses: [
    { book: 'Rut', bookNumber: 8, chapter: 1, verseNumber: 16 },
    { book: '1.Mosebog', bookNumber: 1, chapter: 1, verseNumber: 1 },
    { book: 'Salme', bookNumber: 19, chapter: 23, verseNumber: 1 },
    { book: 'Johannes', bookNumber: 43, chapter: 3, verseNumber: 16 },
    { book: 'Daniel', bookNumber: 27, chapter: 6, verseNumber: 23 },
  ],
}

const quiz = (page: Page) => page.locator('bg-daily-quiz')
const startButton = (page: Page) => page.getByRole('button', { name: "Start today's quiz" })

/** Opens the quiz on the Bible picker, with `dailyQuiz` as today's quiz. */
async function openBiblePicker(page: Page, dailyQuiz: unknown = FIXED_QUIZ) {
  await page.route('**/api/daily-quiz', (route) => route.fulfill({ json: dailyQuiz }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Social' }).click()
  await page.getByRole('button', { name: /Play today's quiz/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Daily quiz' })).toBeVisible()
}

/** Opens the quiz and starts it with the server's translation. */
async function openDailyQuiz(page: Page) {
  await openBiblePicker(page)
  await startButton(page).click()
}

async function guessBook(page: Page, book: string) {
  await quiz(page).getByRole('radio', { name: book, exact: true }).check()
  await page.getByRole('button', { name: 'Guess' }).click()
}

test('Social offers the daily quiz', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Social' }).click()
  await expect(page.getByRole('button', { name: /Play today's quiz/ })).toBeVisible()
})

test('the quiz plays its five verses, in order, and adds up the score', async ({ page }) => {
  await openDailyQuiz(page)
  await expect(quiz(page)).toContainText('2026-10-01')

  // Verse 1: everything right.
  await expect(quiz(page)).toContainText('Verse 1 of 5')
  await expect(quiz(page).locator('bg-verse-card .text')).toBeVisible()
  await quiz(page).getByRole('radio', { name: 'Rut', exact: true }).check()
  await quiz(page).getByRole('slider', { name: 'Chapter (optional)' }).fill('1')
  await quiz(page).getByRole('slider', { name: 'Verse (optional)' }).fill('16')
  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(quiz(page).locator('.feedback')).toContainText('+1110 points')
  await expect(quiz(page).locator('.feedback')).toContainText('it was Rut 1:16')

  // The next-verse button takes focus, so Enter carries on.
  const next = page.getByRole('button', { name: 'Next verse' })
  await expect(next).toBeFocused()
  await page.keyboard.press('Enter')

  // Verses 2–5: book only, or wrong.
  await expect(quiz(page)).toContainText('Verse 2 of 5')
  await guessBook(page, '1.Mosebog')
  await expect(quiz(page).locator('.feedback')).toContainText('+10 points')
  await next.click()

  for (const [round, book] of [[3, 'Rut'], [4, 'Rut'], [5, 'Rut']] as const) {
    await expect(quiz(page)).toContainText(`Verse ${round} of 5`)
    await guessBook(page, book)
    await expect(quiz(page).locator('.feedback')).toContainText('No points')
    await page.getByRole('button', { name: round === 5 ? 'See results' : 'Next verse' }).click()
  }

  await expect(quiz(page)).toContainText("Today's score: 1120 points")
  await expect(quiz(page).getByRole('listitem')).toHaveCount(5)

  await page.getByRole('button', { name: 'Back to Social' }).click()
  await expect(page.getByRole('button', { name: /Play today's quiz/ })).toBeVisible()
})

test('a quiz that cannot be loaded says so', async ({ page }) => {
  await page.route('**/api/daily-quiz', (route) => route.fulfill({ status: 503, json: {} }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Social' }).click()
  await page.getByRole('button', { name: /Play today's quiz/ }).click()
  await startButton(page).click()

  await expect(page.getByRole('alert')).toContainText("Today's quiz couldn't be loaded")
  await page.getByRole('button', { name: 'Back to Social' }).click()
  await expect(page.getByRole('button', { name: /Play today's quiz/ })).toBeVisible()
})

test('a countdown at the top shows the time left until the next quiz', async ({ page }) => {
  // Frozen at an exact moment, so the seconds shown don't depend on how
  // fast the test runs.
  await page.clock.install({ time: new Date('2026-10-01T23:59:40Z') })
  await page.clock.pauseAt(new Date('2026-10-01T23:59:50Z'))
  await openDailyQuiz(page)

  const countdown = quiz(page).getByRole('timer')
  await expect(countdown).toHaveText('Next quiz in 00:00:10')

  // On top of the page: above the heading.
  const countdownTop = (await countdown.boundingBox())!.y
  const headingTop = (await page.getByRole('heading', { level: 1, name: 'Daily quiz' }).boundingBox())!.y
  expect(countdownTop).toBeLessThan(headingTop)

  await page.clock.runFor(3000)
  await expect(countdown).toHaveText('Next quiz in 00:00:07')
})

test('at 00:00 UTC the countdown offers the new quiz, without interrupting the current one', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T23:59:40Z') })
  await page.clock.pauseAt(new Date('2026-10-01T23:59:58Z'))
  await openDailyQuiz(page)
  await expect(quiz(page)).toContainText('Verse 1 of 5')

  await page.clock.runFor(3000)
  await expect(quiz(page).getByRole('timer')).toHaveText('A new quiz is ready.')
  await expect(quiz(page)).toContainText('Verse 1 of 5')

  const NEW_QUIZ = { ...FIXED_QUIZ, date: '2026-10-02' }
  await page.route('**/api/daily-quiz', (route) => route.fulfill({ json: NEW_QUIZ }))
  await page.getByRole('button', { name: 'Play the new quiz' }).click()
  await expect(quiz(page)).toContainText('2026-10-02')
  await expect(quiz(page).getByRole('timer')).toHaveText('Next quiz in 23:59:59')
})

test('the player chooses their Bible before the quiz starts', async ({ page }) => {
  await openBiblePicker(page)

  // The same picker as everywhere else: a server translation by default,
  // or the player's own file.
  await expect(quiz(page).getByRole('tab', { name: 'Server translation' })).toHaveAttribute('aria-selected', 'true')
  await expect(quiz(page).getByRole('tab', { name: 'My own Bible file' })).toBeVisible()
  await expect(quiz(page)).not.toContainText('Verse 1 of 5')

  await startButton(page).click()
  await expect(quiz(page)).toContainText('Verse 1 of 5')
})

// The player's own file: a full Genesis 1 only, spelling its book "Genesis".
// Today's quiz has a verse it lacks (Rut 1:16), which can be skipped.
const GENESIS_QUIZ = {
  date: '2026-10-01',
  verses: [
    { book: '1.Mosebog', bookNumber: 1, chapter: 1, verseNumber: 1 },
    { book: 'Rut', bookNumber: 8, chapter: 1, verseNumber: 16 },
    { book: '1.Mosebog', bookNumber: 1, chapter: 1, verseNumber: 2 },
    { book: '1.Mosebog', bookNumber: 1, chapter: 1, verseNumber: 3 },
    { book: '1.Mosebog', bookNumber: 1, chapter: 1, verseNumber: 4 },
  ],
}

test('the quiz can be played from the player’s own Bible file', async ({ page }) => {
  await openBiblePicker(page, GENESIS_QUIZ)
  await expect(startButton(page)).toBeEnabled()

  await quiz(page).getByRole('tab', { name: 'My own Bible file' }).click()
  // Nothing to start until the file is ready.
  await expect(startButton(page)).toBeDisabled()
  await quiz(page).locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures/genesis1-full.zip'))
  await expect(startButton(page)).toBeEnabled({ timeout: 15_000 })
  await startButton(page).click()

  // Verse 1 comes from the player's own file, with its own book names.
  await expect(quiz(page)).toContainText('Verse 1 of 5')
  await quiz(page).getByRole('radio', { name: 'Genesis', exact: true }).check()
  await quiz(page).getByRole('slider', { name: 'Chapter (optional)' }).fill('1')
  await quiz(page).getByRole('slider', { name: 'Verse (optional)' }).fill('1')
  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(quiz(page).locator('.feedback')).toContainText('+1110 points')
  await page.getByRole('button', { name: 'Next verse' }).click()

  // Verse 2 isn't in the file: it can be skipped, for no points.
  await expect(quiz(page)).toContainText('Verse 2 of 5')
  await expect(quiz(page)).toContainText("This verse isn't in your Bible.")
  await page.getByRole('button', { name: 'Skip this verse' }).click()
  await expect(quiz(page).locator('.feedback')).toContainText('Skipped')
  await page.getByRole('button', { name: 'Next verse' }).click()

  for (const round of [3, 4, 5]) {
    await expect(quiz(page)).toContainText(`Verse ${round} of 5`)
    await quiz(page).getByRole('radio', { name: 'Genesis', exact: true }).check()
    await page.getByRole('button', { name: 'Guess' }).click()
    await page.getByRole('button', { name: round === 5 ? 'See results' : 'Next verse' }).click()
  }

  await expect(quiz(page)).toContainText("Today's score: 1140 points")
  await expect(quiz(page).getByRole('listitem').nth(1)).toContainText('not in your Bible')
})

// The picker's long translation names must not widen the page at phone
// width — here, on the multiplayer screen (the same picker) and in
// singleplayer setup (its own copy of the dropdown).
test('the Bible pickers fit a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  await openBiblePicker(page)
  await expect(startButton(page)).toBeEnabled()
  expect(await overflow()).toBeLessThanOrEqual(0)

  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.locator('bg-translation-source-select select')).toBeVisible()
  expect(await overflow()).toBeLessThanOrEqual(0)

  // Singleplayer setup has its own copy of the same dropdown.
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await expect(page.locator('bg-game-setup select')).not.toHaveValue('')
  expect(await overflow()).toBeLessThanOrEqual(0)
})

