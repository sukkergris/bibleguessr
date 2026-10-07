import { test, expect, type Locator, type Page } from '@playwright/test'

// Picking a chapter or verse by tapping its slider — see
// docs/web/book-picker. iPhone Safari moves a range slider only when a
// drag starts exactly on its thumb: a tap anywhere else on the track does
// nothing, and at the start of a round every thumb sits at the far left.
// In a Chapters game, and a Books game with one book, the book is given,
// so those sliders are all there is to pick — on an iPhone nothing could
// be chosen. Requires both dev servers already running — see
// playwright.config.ts.

// A book the bundled server translation has (its own spelling).
const SERVER_BOOK = 'Daniel'

const guessForm = (page: Page) => page.locator('bg-guess-form')
const summary = (page: Page) => guessForm(page).locator('.guess-summary')
const chapterSlider = (page: Page) => guessForm(page).getByRole('slider', { name: 'Chapter (optional)' })
const verseSlider = (page: Page) => guessForm(page).getByRole('slider', { name: 'Verse (optional)' })

// Where on the slider to tap, as a share of its width.
const LEFT_END = 0
const MIDDLE = 0.5
const RIGHT_END = 1

/** A tap the way iPhone Safari leaves it to the page: the slider gets the
 * pointer events, but the browser itself doesn't move it. Playwright has
 * no iOS Safari; an untrusted event has no native default action, which
 * is exactly that. */
async function tapAsIPhoneSafari(slider: Locator, share: number) {
  await slider.evaluate((input, share) => {
    const box = input.getBoundingClientRect()
    const init: PointerEventInit = {
      bubbles: true,
      composed: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'touch',
      clientX: box.left + box.width * share,
      clientY: box.top + box.height / 2,
    }
    input.dispatchEvent(new PointerEvent('pointerdown', init))
    input.dispatchEvent(new PointerEvent('pointerup', init))
  }, share)
}

async function startChaptersGame(page: Page, chapters: string[]) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Chapters' }).first().click()
  await page.getByLabel('Book').selectOption(SERVER_BOOK)
  for (const chapter of chapters) {
    await page.locator('.chapter', { hasText: new RegExp(`^\\s*${chapter}\\s*$`) }).locator('input[type="checkbox"]').check()
  }
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
}

async function startLoneBookGame(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Books' }).first().click()
  await page.locator('.book', { hasText: SERVER_BOOK }).first().locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
}

test('"Chapters": tapping the chapter and verse sliders picks what is under the finger', async ({ page }) => {
  await startChaptersGame(page, ['1', '2'])

  // Any chapter, 1, 2 — the middle is chapter 1, the right end chapter 2.
  await tapAsIPhoneSafari(chapterSlider(page), MIDDLE)
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Chapter 1')
  await tapAsIPhoneSafari(chapterSlider(page), RIGHT_END)
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Chapter 2')
  await expect(summary(page)).toHaveText(`Your guess: ${SERVER_BOOK} 2`)

  // The verse slider opens up for the chosen chapter and takes taps too:
  // the right end is the chapter's last verse, the left end any verse.
  await expect(verseSlider(page)).toBeEnabled()
  const lastVerse = await verseSlider(page).getAttribute('max')
  await tapAsIPhoneSafari(verseSlider(page), RIGHT_END)
  await expect(verseSlider(page)).toHaveAttribute('aria-valuetext', `Verse ${lastVerse}`)
  await expect(summary(page)).toHaveText(`Your guess: ${SERVER_BOOK} 2:${lastVerse}`)
  await tapAsIPhoneSafari(verseSlider(page), LEFT_END)
  await expect(verseSlider(page)).toHaveAttribute('aria-valuetext', 'Any verse')

  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(page.locator('.feedback')).toContainText(`you guessed ${SERVER_BOOK} 2,`)
})

test('"Books" with one book: tapping the chapter slider picks what is under the finger', async ({ page }) => {
  await startLoneBookGame(page)

  await expect(chapterSlider(page)).toBeEnabled()
  const lastChapter = await chapterSlider(page).getAttribute('max')
  await tapAsIPhoneSafari(chapterSlider(page), RIGHT_END)
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', `Chapter ${lastChapter}`)
  await expect(summary(page)).toHaveText(`Your guess: ${SERVER_BOOK} ${lastChapter}`)
})

test('a tap does nothing on a slider that is still disabled', async ({ page }) => {
  await startChaptersGame(page, ['1', '2'])

  // No chapter yet, so the verse slider waits for one.
  await expect(verseSlider(page)).toBeDisabled()
  await tapAsIPhoneSafari(verseSlider(page), RIGHT_END)
  await expect(verseSlider(page)).toHaveAttribute('aria-valuetext', 'Any verse')
  await expect(summary(page)).toHaveText(`Your guess: ${SERVER_BOOK}`)
})

test('where the browser moves the slider itself, a click lands where it says', async ({ page }) => {
  await startChaptersGame(page, ['1', '2'])

  // A real click, which this browser handles natively — the tap fallback
  // must leave it alone rather than move the slider a second time.
  const box = (await chapterSlider(page).boundingBox())!
  await page.mouse.click(box.x + box.width * MIDDLE, box.y + box.height / 2)
  await expect(chapterSlider(page)).toHaveAttribute('aria-valuetext', 'Chapter 1')
  await expect(summary(page)).toHaveText(`Your guess: ${SERVER_BOOK} 1`)
})
