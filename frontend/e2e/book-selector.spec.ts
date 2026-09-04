import { test, expect, type Page } from '@playwright/test'

// Exercises "Select a Bible" (docs/SCRUM/Feature.BibleSelector.md) — three
// separate singleplayer game types (The Bible / Books / Chapters), each
// its own entry point from mode-select, each with its own book/chapter
// selector that persists independently across visits.

async function openMode(page: Page, buttonName: 'The Bible' | 'Books' | 'Chapters') {
  await page.goto('/')
  await page.getByRole('button', { name: buttonName, exact: false }).first().click()
}

async function goHome(page: Page) {
  await page.getByRole('button', { name: '← Home' }).click()
}

test('"The Bible" plays from any book, no selector shown', async ({ page }) => {
  await openMode(page, 'The Bible')

  // No book/chapter selector for this game type.
  await expect(page.locator('.scope-selector-block')).toHaveCount(0)

  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
})

test('"Books" restricts to only the checked books', async ({ page }) => {
  await openMode(page, 'Books')

  const daniel = page.locator('.book', { hasText: 'Daniel' }).first()
  await daniel.locator('input[type="checkbox"]').check()
  await expect(page.getByText('1 book selected.')).toBeVisible()

  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')

  // Guess (wrong book, doesn't matter for this check) to reveal the
  // reference, and confirm it's always Daniel — for every round, so this
  // confirms the restriction actually reached the backend and constrained
  // getRandomVerse, not just the UI state at setup time.
  for (let round = 1; round <= 3; round++) {
    const bookField = page.getByLabel('Book')
    await bookField.selectOption('Daniel')
    await bookField.press('Enter')
    await expect(page.locator('.feedback')).toContainText('Daniel')
    await page.getByRole('button', { name: /Next verse|See results/ }).click()
  }
})

test('"Books" mode guess form is a dropdown listing only the selected books', async ({ page }) => {
  await openMode(page, 'Books')

  // Pick two books at setup.
  await page.locator('.book', { hasText: 'Daniel' }).first().locator('input[type="checkbox"]').check()
  await page.locator('.book', { hasText: '1.Mosebog' }).first().locator('input[type="checkbox"]').check()
  await expect(page.getByText('2 books selected.')).toBeVisible()

  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')

  // The Book field is a real <select>, not a free-text input.
  const bookField = page.getByLabel('Book')
  await expect(bookField).toHaveJSProperty('tagName', 'SELECT')

  // It only offers exactly the two selected books (plus the disabled
  // placeholder) — not every book in the translation.
  const optionTexts = await bookField.locator('option').allTextContents()
  expect(optionTexts.sort()).toEqual(['1.Mosebog', 'Choose a book…', 'Daniel'].sort())

  // A guess submits successfully by picking from the dropdown.
  await bookField.selectOption('1.Mosebog')
  await bookField.press('Enter')
  await expect(page.locator('.feedback')).toBeVisible()
})

test('"Chapters" restricts to a single book\'s checked chapters', async ({ page }) => {
  await openMode(page, 'Chapters')

  await page.getByLabel('Book').selectOption('Daniel')

  const chapterOne = page.locator('.chapter', { hasText: '1' }).first()
  await chapterOne.locator('input[type="checkbox"]').check()
  await expect(page.getByText('1 chapter of Daniel selected.')).toBeVisible()

  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')

  for (let round = 1; round <= 3; round++) {
    await page.locator('bg-guess-form input').first().fill('Genesis')
    await page.keyboard.press('Enter')
    await expect(page.locator('.feedback')).toContainText('Daniel 1:')
    await page.getByRole('button', { name: /Next verse|See results/ }).click()
  }
})

test('"Books" selection persists after backing out to Home and returning', async ({ page }) => {
  await openMode(page, 'Books')

  const daniel = page.locator('.book', { hasText: 'Daniel' }).first()
  await daniel.locator('input[type="checkbox"]').check()
  await expect(page.getByText('1 book selected.')).toBeVisible()

  await goHome(page)
  await page.getByRole('button', { name: 'Books', exact: false }).first().click()

  await expect(page.getByText('1 book selected.')).toBeVisible()
  await expect(page.locator('.book', { hasText: 'Daniel' }).first().locator('input')).toBeChecked()
})

test('"Chapters" selection persists independently of "Books"', async ({ page }) => {
  // Make a selection in Books mode.
  await openMode(page, 'Books')
  await page.locator('.book', { hasText: 'Daniel' }).first().locator('input[type="checkbox"]').check()
  await expect(page.getByText('1 book selected.')).toBeVisible()
  await goHome(page)

  // Make a different selection in Chapters mode — "1.Mosebog" (Genesis) in
  // this translation's own spelling, not the English name.
  await page.getByRole('button', { name: 'Chapters', exact: false }).first().click()
  await page.getByLabel('Book').selectOption('1.Mosebog')
  await page.locator('.chapter', { hasText: '1' }).first().locator('input[type="checkbox"]').check()
  await expect(page.getByText('1 chapter of 1.Mosebog selected.')).toBeVisible()
  await goHome(page)

  // Books mode still shows its own earlier selection, untouched by what
  // happened in Chapters mode.
  await page.getByRole('button', { name: 'Books', exact: false }).first().click()
  await expect(page.getByText('1 book selected.')).toBeVisible()
  await expect(page.locator('.book', { hasText: 'Daniel' }).first().locator('input')).toBeChecked()
})
