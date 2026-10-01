import { test, expect, type Page } from '@playwright/test'

// Moving on to the next verse must not make the screen jump: the verse
// card keeps its size while the next verse loads, and the guess form
// comes back at its full size straight away instead of growing once the
// book list has loaded again. See docs/web/book-picker.

/** Extra latency on every API call, so the loading window is wide enough
 * to observe the way a real network makes it. */
const API_DELAY_MS = 400

async function playFirstRound(page: Page) {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toContainText('Verse 1')
  await page.locator('bg-guess-form').getByRole('radio', { name: 'Rut' }).check()
  await page.getByRole('button', { name: 'Guess' }).click()
  await expect(page.locator('.feedback')).toBeVisible()
}

/** Records the verse card's and the guess form's heights on every frame
 * until the next verse has loaded. */
async function sampleHeightsWhileLoading(page: Page) {
  await page.evaluate(() => {
    const app = document.querySelector('bg-app')!.shadowRoot!
    const samples: { card: number; form: number; loading: boolean }[] = []
    ;(window as unknown as { samples: typeof samples }).samples = samples
    const tick = () => {
      const card = app.querySelector('bg-verse-card')
      const form = app.querySelector('bg-guess-form')
      const loading = !!card?.shadowRoot?.querySelector('.loading')
      if (card && form) samples.push({ card: card.getBoundingClientRect().height, form: form.getBoundingClientRect().height, loading })
      if (samples.length === 0 || samples.at(-1)!.loading) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

test('the next verse loads without the screen jumping', async ({ page }) => {
  await playFirstRound(page)
  const cardBefore = (await page.locator('bg-verse-card').boundingBox())!.height

  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS))
    await route.continue()
  })
  await sampleHeightsWhileLoading(page)
  await page.getByRole('button', { name: 'Next verse' }).click()
  await expect(page.locator('.round')).toContainText('Verse 2')
  await expect(page.locator('bg-verse-card .loading')).toHaveCount(0)

  const samples = await page.evaluate(() => (window as unknown as { samples: { card: number; form: number; loading: boolean }[] }).samples)
  const whileLoading = samples.filter((sample) => sample.loading)
  expect(whileLoading.length).toBeGreaterThan(0)

  // The card keeps the size it had, rather than collapsing to one line.
  for (const sample of whileLoading) expect(sample.card).toBeCloseTo(cardBefore, 0)
  // The form is at its final size from the first frame on.
  const finalForm = (await page.locator('bg-guess-form').boundingBox())!.height
  for (const sample of samples) expect(sample.form).toBeCloseTo(finalForm, 0)
})

test('the previous verse is not shown or guessable while the next one loads', async ({ page }) => {
  await playFirstRound(page)

  await page.route('**/api/verses/random**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS))
    await route.continue()
  })
  await page.getByRole('button', { name: 'Next verse' }).click()

  await expect(page.locator('bg-verse-card')).toContainText('Loading verse…')
  await expect(page.getByRole('button', { name: 'Guess' })).toBeDisabled()
})
