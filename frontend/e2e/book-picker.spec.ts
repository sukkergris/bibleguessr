import { test, expect, type Page } from '@playwright/test'

// The guess form — see docs/web/book-picker. Players pick the book from
// tiles or a slider, and the chapter and verse with sliders — the
// sliders stacked in a bar pinned to the bottom under a summary of the
// guess so far. Nothing is typed. Book names come from the selected Bible
// (here the bundled bibelen-dk translation).

async function startBibleGame(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
}

const guessForm = (page: Page) => page.locator('bg-guess-form')
const bookSlider = (page: Page) => guessForm(page).getByRole('slider', { name: 'Book' })
const summary = (page: Page) => guessForm(page).locator('.guess-summary')
const chapterSlider = (page: Page) => guessForm(page).getByRole('slider', { name: 'Chapter (optional)' })
const verseSlider = (page: Page) => guessForm(page).getByRole('slider', { name: 'Verse (optional)' })

test('shows every book of the selected Bible, grouped by testament and category', async ({ page }) => {
  await startBibleGame(page)

  const form = guessForm(page)
  await expect(form.getByRole('radio')).toHaveCount(66)
  await expect(form.getByRole('group', { name: 'Old Testament' })).toBeVisible()
  await expect(form.getByRole('group', { name: 'New Testament' })).toBeVisible()

  // Names are the translation's own spelling, not a hardcoded list.
  const law = form.getByRole('group', { name: 'Law' })
  await expect(law.getByRole('radio')).toHaveCount(5)
  await expect(law.getByRole('radio').first()).toHaveAccessibleName('1.Mosebog')
  await expect(form.getByRole('group', { name: 'Prophecy' }).getByRole('radio')).toHaveAccessibleName('Aabenbaringen')
})

test('clicking a tile selects it and the guess submits without typing', async ({ page }) => {
  await startBibleGame(page)

  const daniel = guessForm(page).getByRole('radio', { name: 'Daniel' })
  await guessForm(page).locator('.book-tile', { hasText: 'Daniel' }).click()
  await expect(daniel).toBeChecked()
  await expect(summary(page)).toHaveText('Your guess: Daniel')

  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(page.locator('.feedback')).toBeVisible()
})

test('the book slider is an alternative to the tiles, and the two stay in sync', async ({ page }) => {
  await startBibleGame(page)

  // Position 0 is "no book", where it starts; then every book in Bible order.
  await expect(bookSlider(page)).toHaveAttribute('max', '66')
  await expect(bookSlider(page)).toHaveAttribute('aria-valuetext', 'No book picked')
  await expect(summary(page)).toHaveText('Your guess: pick a book')

  await bookSlider(page).fill('1')
  await expect(guessForm(page).getByRole('radio', { name: '1.Mosebog' })).toBeChecked()
  await expect(bookSlider(page)).toHaveAttribute('aria-valuetext', '1.Mosebog')
  await expect(summary(page)).toHaveText('Your guess: 1.Mosebog')

  await guessForm(page).getByRole('radio', { name: 'Rut' }).check()
  await expect(bookSlider(page)).toHaveAttribute('aria-valuetext', 'Rut')
})

test('book, chapter and verse are always stacked in that order, with the guess summary on top', async ({ page }) => {
  // Wide enough that side by side would fit — they must stack anyway.
  await page.setViewportSize({ width: 1280, height: 900 })
  await startBibleGame(page)

  const top = async (locator: ReturnType<typeof bookSlider>) => (await locator.boundingBox())!.y
  const summaryTop = await top(summary(page))
  const bookTop = await top(bookSlider(page))
  const chapterTop = await top(chapterSlider(page))
  const verseTop = await top(verseSlider(page))
  expect(summaryTop).toBeLessThan(bookTop)
  expect(bookTop).toBeLessThan(chapterTop)
  expect(chapterTop).toBeLessThan(verseTop)
})

test('chapter and verse sliders are scoped to the chosen book and chapter', async ({ page }) => {
  await startBibleGame(page)

  // Nothing to pick until the step before it is done.
  await expect(chapterSlider(page)).toBeDisabled()
  await expect(chapterSlider(page)).toHaveAccessibleDescription('Pick a book first.')
  await expect(verseSlider(page)).toBeDisabled()
  await expect(verseSlider(page)).toHaveAccessibleDescription('Pick a chapter first.')

  // Rut (Ruth) has 4 chapters. Position 0 is "Any chapter", where it starts.
  await guessForm(page).getByRole('radio', { name: 'Rut' }).check()
  await expect(chapterSlider(page)).toBeEnabled()
  await expect(chapterSlider(page)).toHaveAttribute('max', '4')
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Any chapter')

  // Rut 1 has 22 verses.
  await chapterSlider(page).fill('1')
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Chapter 1')
  await expect(verseSlider(page)).toHaveAttribute('max', '22')
  await expect(verseSlider(page)).toHaveAttribute('aria-valuetext', 'Any verse')
  await verseSlider(page).fill('16')
  await expect(verseSlider(page)).toHaveAttribute('aria-valuetext', 'Verse 16')

  await expect(summary(page)).toHaveText('Your guess: Rut 1:16')

  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(page.locator('.feedback')).toContainText('you guessed Rut 1:16')
})

test('picking another book or chapter clears what depended on it', async ({ page }) => {
  await startBibleGame(page)

  await guessForm(page).getByRole('radio', { name: 'Rut' }).check()
  await chapterSlider(page).fill('2')
  await verseSlider(page).fill('3')

  await chapterSlider(page).fill('1')
  await expect(verseSlider(page)).toHaveAttribute('aria-valuetext', 'Any verse')

  await guessForm(page).getByRole('radio', { name: 'Ester' }).check()
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Any chapter')
  await expect(verseSlider(page)).toBeDisabled()
})

test('the guess bar stays on screen while the book grid is scrolled past', async ({ page }) => {
  // Short enough that the book grid alone fills the screen. Scrolled so
  // the form starts at the top: the bar is pinned within the form, so
  // this is the case it exists for (the verse card above varies in
  // length with the random verse, so scrolling to the page top would make
  // where the form starts random too).
  await page.setViewportSize({ width: 390, height: 480 })
  await startBibleGame(page)
  await guessForm(page).evaluate((form) => form.scrollIntoView({ block: 'start' }))

  await expect(page.getByRole('button', { name: 'Guess' })).toBeInViewport()
  await expect(summary(page)).toBeInViewport()
  await expect(bookSlider(page)).toBeInViewport()
  await expect(verseSlider(page)).toBeInViewport()
})

test('the grid is operable by keyboard alone', async ({ page }) => {
  await startBibleGame(page)

  // Focus lands on the first tile once the verse has loaded, without
  // selecting it; arrow keys move and select; Enter guesses.
  const first = guessForm(page).getByRole('radio', { name: '1.Mosebog' })
  await expect(first).toBeFocused()
  await expect(first).not.toBeChecked()

  await page.keyboard.press('ArrowRight')
  const second = guessForm(page).getByRole('radio', { name: '2.Mosebog' })
  await expect(second).toBeFocused()
  await expect(second).toBeChecked()

  // Tab moves on to the book slider (showing the same book), then the
  // chapter slider; the arrow keys move them.
  await page.keyboard.press('Tab')
  await expect(bookSlider(page)).toBeFocused()
  await expect(bookSlider(page)).toHaveAttribute('aria-valuetext', '2.Mosebog')
  await expect(chapterSlider(page)).toBeEnabled()
  await page.keyboard.press('Tab')
  await expect(chapterSlider(page)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Chapter 1')

  // ...and then on to the verse slider.
  await expect(verseSlider(page)).toBeEnabled()
  await page.keyboard.press('Tab')
  await expect(verseSlider(page)).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.locator('.feedback')).toContainText('you guessed 2.Mosebog 1,')
})
