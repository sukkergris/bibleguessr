import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'

// One Bible choice, remembered for every setup screen and across visits —
// see docs/web/remembered-bible. The bundled server offers a single
// translation, so a remembered translation can't be told from the default;
// these tests use an uploaded file instead. Requires both dev servers
// already running — see playwright.config.ts.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE_NAME = 'genesis1-full.zip'
const FIXTURE = path.join(__dirname, 'fixtures', FILE_NAME)
const STORAGE_KEY = 'bibleguessr:preferences:bibleChoice:v1'

const fileTab = (page: Page) => page.getByRole('tab', { name: 'My own Bible file' })
const serverTab = (page: Page) => page.getByRole('tab', { name: 'Server translation' })
const usingFile = (page: Page) => page.getByText(/^✓ Using/)

async function goHome(page: Page) {
  await page.getByRole('button', { name: '← Home' }).click()
}

async function openSingleplayer(page: Page, gameType: 'The Bible' | 'Books' | 'Chapters') {
  await page.getByRole('button', { name: gameType }).first().click()
}

async function uploadFile(page: Page) {
  await fileTab(page).click()
  await page.getByLabel('Choose a Bible file').setInputFiles(FIXTURE)
  await expect(usingFile(page)).toContainText(FILE_NAME, { timeout: 15_000 })
}

/** The file is preselected, shown, and announced once as last time's. */
async function expectFileRestored(page: Page) {
  await expect(fileTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(usingFile(page)).toContainText(FILE_NAME)
  await expect(page.getByRole('status').filter({ hasText: 'from last time' })).toHaveText(
    `Using ${FILE_NAME} from last time.`,
  )
}

async function expectServerTranslation(page: Page) {
  await expect(serverTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Translation')).not.toHaveValue('')
  await expect(usingFile(page)).toHaveCount(0)
}

test('a Bible file chosen in one game type is preselected everywhere, after a reload and on "Play again"', async ({
  page,
}) => {
  // Everything the page sends, to check the choice never leaves the browser.
  const sent: string[] = []
  page.on('request', (request) => sent.push(`${request.url()} ${request.postData() ?? ''}`))

  await page.goto('/')
  await openSingleplayer(page, 'The Bible')
  await uploadFile(page)

  await goHome(page)
  await openSingleplayer(page, 'Chapters')
  await expectFileRestored(page)
  // The game type's selector reads the remembered file's own books.
  await expect(page.getByLabel('Book').locator('option', { hasText: 'Genesis' })).toHaveCount(1)

  await goHome(page)
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expectFileRestored(page)

  await goHome(page)
  await page.getByRole('button', { name: 'Social' }).click()
  await page.getByRole('button', { name: /Play today's quiz/ }).click()
  await expectFileRestored(page)

  // A new visit.
  await page.goto('/')
  await openSingleplayer(page, 'The Bible')
  await expectFileRestored(page)

  // Play a whole game from it, then "Play again".
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
  while (!(await page.getByRole('button', { name: 'Play again' }).isVisible())) {
    const genesis = page.locator('bg-guess-form').getByRole('radio', { name: 'Genesis' })
    await expect(genesis).toBeEnabled()
    await genesis.check()
    await page.getByRole('button', { name: 'Guess' }).click()
    await page.getByRole('button', { name: /Next verse|See results/ }).click()
  }
  await page.getByRole('button', { name: 'Play again' }).click()
  await openSingleplayer(page, 'Books')
  await expectFileRestored(page)

  expect(sent.join('\n')).not.toContain(FILE_NAME.replace('.zip', ''))
})

test('switching back to a server translation is remembered too', async ({ page }) => {
  await page.goto('/')
  await openSingleplayer(page, 'The Bible')
  await uploadFile(page)
  await serverTab(page).click()

  await goHome(page)
  await openSingleplayer(page, 'Books')
  await expectServerTranslation(page)

  // A new visit.
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expectServerTranslation(page)
})

test('a remembered file that is no longer cached falls back to the server translation', async ({ page }) => {
  await page.goto('/')
  await openSingleplayer(page, 'The Bible')
  await uploadFile(page)
  await page.getByRole('button', { name: 'Choose a different file' }).click()
  await page.getByRole('button', { name: `Remove ${FILE_NAME} from cache` }).click()

  await goHome(page)
  await openSingleplayer(page, 'The Bible')
  await expectServerTranslation(page)
  await expect(page.getByRole('button', { name: 'Start game' })).toBeEnabled()
  await expect(page.locator('bg-game-setup .error')).toHaveCount(0)
})

test('a malformed remembered value falls back to the server translation without an error', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{"kind":"file","fingerprint":'), STORAGE_KEY)
  await page.goto('/')
  await openSingleplayer(page, 'The Bible')

  await expectServerTranslation(page)
  await expect(page.getByRole('button', { name: 'Start game' })).toBeEnabled()
  await expect(page.locator('bg-game-setup .error')).toHaveCount(0)
})

test('a Books selection comes back only with the Bible it was made in', async ({ page }) => {
  await page.goto('/')
  await openSingleplayer(page, 'Books')
  await page.locator('.book', { hasText: 'Daniel' }).first().locator('input[type="checkbox"]').check()
  await expect(page.getByText('1 book selected.')).toBeVisible()

  // The file has no Daniel: its Books selection starts empty...
  await uploadFile(page)
  await expect(page.getByText('No books checked yet')).toBeVisible()
  await goHome(page)
  await openSingleplayer(page, 'Books')
  await expectFileRestored(page)
  await expect(page.getByText('No books checked yet')).toBeVisible()

  // ...and back on the server translation, Daniel is still there.
  await serverTab(page).click()
  await expect(page.getByText('1 book selected.')).toBeVisible()
  await expect(page.locator('.book', { hasText: 'Daniel' }).first().locator('input')).toBeChecked()
})
