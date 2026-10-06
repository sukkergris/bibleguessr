import { test, expect } from '@playwright/test'

// The Nerd Panel's "Famous verses" section — see docs/web/famous-verses.
// The list is folded away and fetched from /api/famous-verses the first
// time it's opened. The endpoint is mocked so the contents are known.

type Page = import('@playwright/test').Page

const famousVerses = [
  { book: '1.Mosebog', bookNumber: 1, chapter: 1, verseNumber: 1 },
  { book: '1.Mosebog', bookNumber: 1, chapter: 9, verseNumber: 4 },
  { book: 'Johannes', bookNumber: 43, chapter: 3, verseNumber: 16 },
]

async function openNerdPanel(page: Page) {
  await page.goto('/')
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.getByRole('heading', { name: 'Nerd stuff' })).toBeVisible()
}

const section = (page: Page) => page.getByRole('region', { name: 'Famous verses' })
const showList = (page: Page) => section(page).getByText('Show the list')

test('lists the famous verses by book, in the order the server sends them', async ({ page }) => {
  await page.route('**/api/famous-verses', (route) => route.fulfill({ json: famousVerses }))
  await openNerdPanel(page)
  await showList(page).click()

  await expect(section(page)).toContainText('3 verses, in Bible order.')
  await expect(section(page).locator('dt')).toHaveText(['1.Mosebog', 'Johannes'])
  await expect(section(page).locator('dd')).toHaveText(['1:1, 9:4', '3:16'])
})

test('is fetched only when the list is opened', async ({ page }) => {
  let requests = 0
  await page.route('**/api/famous-verses', (route) => {
    requests++
    return route.fulfill({ json: famousVerses })
  })
  await openNerdPanel(page)
  expect(requests).toBe(0)

  await showList(page).click()
  await expect(section(page).locator('dt').first()).toHaveText('1.Mosebog')
  expect(requests).toBe(1)
})

test('opens from the keyboard', async ({ page }) => {
  await page.route('**/api/famous-verses', (route) => route.fulfill({ json: famousVerses }))
  await openNerdPanel(page)
  await showList(page).focus()
  await page.keyboard.press('Enter')

  await expect(section(page).locator('dt').first()).toHaveText('1.Mosebog')
})

test('says so when the list cannot be loaded, and tries again on the next opening', async ({ page }) => {
  await page.route('**/api/famous-verses', (route) => route.abort())
  await openNerdPanel(page)
  await showList(page).click()
  await expect(section(page).locator('.error')).toBeVisible()

  await page.unroute('**/api/famous-verses')
  await page.route('**/api/famous-verses', (route) => route.fulfill({ json: famousVerses }))
  await showList(page).click() // close
  await showList(page).click() // open again
  await expect(section(page).locator('dt')).toHaveText(['1.Mosebog', 'Johannes'])
})
