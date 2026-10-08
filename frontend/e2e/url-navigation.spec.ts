import { test, expect, type Page } from '@playwright/test'

// Every screen has its own address, so a shared link leads straight to it
// and Back/Forward move between screens — see docs/web/url-routing.

const pathOf = (page: Page) => new URL(page.url()).pathname

const socialHome = (page: Page) => page.getByRole('button', { name: /Play today's quiz/ })
const dailyQuiz = (page: Page) => page.locator('bg-daily-quiz').getByRole('heading', { name: 'Daily quiz' })
const homeScreen = (page: Page) => page.getByRole('button', { name: 'Multiplayer' })

test('a daily quiz link opens the daily quiz directly', async ({ page }) => {
  await page.goto('/social/daily-quiz')

  await expect(dailyQuiz(page)).toBeVisible()
  await expect(page).toHaveTitle('Daily quiz — BibleGuessr')

  // A reload stays there.
  await page.reload()
  await expect(dailyQuiz(page)).toBeVisible()
})

test('moving between screens updates the address, and Back and Forward retrace it', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('BibleGuessr')

  await page.getByRole('button', { name: 'Social' }).click()
  expect(pathOf(page)).toBe('/social')
  await socialHome(page).click()
  expect(pathOf(page)).toBe('/social/daily-quiz')
  await expect(dailyQuiz(page)).toBeVisible()

  await page.goBack()
  await expect(socialHome(page)).toBeVisible()
  expect(pathOf(page)).toBe('/social')
  await expect(page).toHaveTitle('Social — BibleGuessr')

  await page.goBack()
  await expect(homeScreen(page)).toBeVisible()
  expect(pathOf(page)).toBe('/')

  await page.goForward()
  await expect(socialHome(page)).toBeVisible()
  await page.goForward()
  await expect(dailyQuiz(page)).toBeVisible()
})

test('each game type has its own address', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Books', exact: false }).first().click()
  expect(pathOf(page)).toBe('/play/books')

  await page.goto('/play/books')
  await expect(page.locator('bg-book-selector')).toBeVisible()
  await expect(page).toHaveTitle('Books — BibleGuessr')

  // "← Home" is a move like any other: Back returns to the game type.
  await page.getByRole('button', { name: '← Home' }).click()
  expect(pathOf(page)).toBe('/')
  await page.goBack()
  await expect(page.locator('bg-book-selector')).toBeVisible()
})

test('an unknown address shows the home screen at /', async ({ page }) => {
  await page.goto('/no/such/page')

  await expect(homeScreen(page)).toBeVisible()
  expect(pathOf(page)).toBe('/')
})

test('an ordinary link to one of the app’s own addresses moves within the page', async ({ page }) => {
  await page.goto('/watch/4821')
  await page.evaluate(() => ((window as unknown as { notReloaded: boolean }).notReloaded = true))

  await page.getByRole('link', { name: '← Open BibleGuessr' }).click()

  await expect(homeScreen(page)).toBeVisible()
  expect(pathOf(page)).toBe('/')
  expect(await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded)).toBe(true)
})

async function enterMultiplayer(page: Page, name: string) {
  await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(name)
}

test('a room has its own address, which leads others straight to it', async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const hostName = `Host${suffix}url`
    const guestName = `Guest${suffix}url`

    await host.goto('/')
    await host.getByRole('button', { name: 'Multiplayer' }).click()
    expect(pathOf(host)).toBe('/multiplayer')
    await enterMultiplayer(host, hostName)
    await host.getByRole('button', { name: 'Create a room' }).click()
    const code = (await host.locator('bg-room-setup h1 .code').innerText()).trim()
    await expect.poll(() => pathOf(host)).toBe(`/multiplayer/${code}`)
    await expect(host).toHaveTitle(`Room ${code} — BibleGuessr`)

    // The invite link is that same address.
    await host.getByRole('button', { name: 'Share invite link' }).click()
    await expect(host.getByText('Invite link copied.')).toBeVisible()
    expect(await host.evaluate(() => navigator.clipboard.readText())).toBe(
      `${new URL(host.url()).origin}/multiplayer/${code}`,
    )

    // Following it opens the join screen with the code already filled in.
    await guest.goto(`/multiplayer/${code}`)
    await expect(guest.getByPlaceholder('Room code')).toHaveValue(code)
    await enterMultiplayer(guest, guestName)
    await guest.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(guest.locator('bg-room-setup h1 .code')).toHaveText(code)
    await expect(host.locator('bg-chat-panel').getByText(guestName)).toBeVisible()

    // Back leaves the room, just like "Back to chat selection".
    await host.goBack()
    await expect(host.getByRole('button', { name: 'Create a room' })).toBeVisible()
    expect(pathOf(host)).toBe('/multiplayer')
    await expect(guest.locator('bg-chat-panel').getByText(hostName)).toBeHidden()

    // Forward offers the room again, without joining it behind the
    // player's back.
    await host.goForward()
    await expect(host.getByPlaceholder('Room code')).toHaveValue(code)
    await expect(host.getByRole('button', { name: 'Create a room' })).toBeVisible()
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})
