import { test, expect, type Page } from '@playwright/test'
import { auditA11y, formatFindings } from './helpers/a11y'

// Accessibility coverage across the app's screens — see
// docs/SCRUM/TODO/Feature.Accessibility.md.
//
// These assert the mechanical things a machine can check reliably:
// every interactive control has an accessible name, and no form field is
// named only by a placeholder. They deliberately do NOT claim WCAG
// conformance on their own — the spec also requires a manual pass with a
// real screen reader, which no automated check replaces.

async function expectNoFindings(page: Page, screen: string) {
  const findings = await auditA11y(page)
  expect(findings, `${screen} has accessibility problems:\n${formatFindings(findings)}`).toEqual([])
}

test('the home screen has no unnamed controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Multiplayer' })).toBeVisible()

  await expectNoFindings(page, 'home screen')
})

test('the singleplayer setup screen has no unnamed controls', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible()

  await expectNoFindings(page, 'singleplayer setup')
})

test('the active game screen has no unnamed controls', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()

  await expectNoFindings(page, 'active game')
})

test('the report abuse screen has no unnamed controls', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Report abuse' }).click()
  await expect(page.getByRole('heading', { name: 'Report abuse' })).toBeVisible()

  await expectNoFindings(page, 'report abuse')
})

test('the multiplayer pre-join screen has no unnamed controls', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByRole('button', { name: 'Join World chat' })).toBeVisible()

  await expectNoFindings(page, 'multiplayer pre-join')
})

test('the multiplayer room has no unnamed controls', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Multiplayer' }).click()

  const translation = page.getByRole('combobox', { name: 'Translation' })
  await expect(translation).not.toHaveValue('')
  await page.getByPlaceholder('e.g. Alice').fill(`A11y${Date.now().toString().slice(-6)}`)
  await page.getByRole('button', { name: 'Join World chat' }).click()
  await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()

  await expectNoFindings(page, 'multiplayer room')
})

// Regression test for a real blocker: roster player names were plain <li>
// elements with a click handler, so they were absent from the tab order
// entirely. A keyboard-only player could join a room and chat, but had no
// way to challenge anyone — see
// docs/SCRUM/BUGS/BUG.RosterPlayersCannotBeChallengedByKeyboard.md.
test('a challengeable player can be reached and activated by keyboard', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
    const aliceName = `Alice${suffix}kb`
    const bobName = `Bob${suffix}kb`

    for (const [page, name] of [
      [pageA, aliceName],
      [pageB, bobName],
    ] as const) {
      await page.goto('/')
      await page.getByRole('button', { name: 'Multiplayer' }).click()
      await expect(page.getByRole('combobox', { name: 'Translation' })).not.toHaveValue('')
      await page.getByPlaceholder('e.g. Alice').fill(name)
      await page.getByRole('button', { name: 'Join World chat' }).click()
      await expect(page.getByRole('heading', { name: 'World chat' })).toBeVisible()
    }

    // Bob must be exposed as an interactive control, not a bare list item,
    // and his name must be part of its accessible name so a screen-reader
    // user knows who they are challenging.
    const bobControl = pageA.getByRole('button', { name: new RegExp(bobName) })
    await expect(bobControl).toBeVisible()

    // Reachable by keyboard and activatable with Enter — no mouse.
    await bobControl.focus()
    await expect(bobControl).toBeFocused()
    await pageA.keyboard.press('Enter')

    await expect(
      pageB.getByRole('listitem').filter({ hasText: `${aliceName} wants to play` }),
    ).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

// The Bible-file picker's accessible name and its state announcements —
// see the "File upload and file names" section of
// docs/SCRUM/TODO/Feature.Accessibility.md. Both were confirmed missing:
// the input was named only by the drop-zone's long instruction sentence,
// and the setup screen had no live region at all, so a screen-reader user
// was never told a file had been selected, parsed, or failed.
test('the Bible-file picker has a clear accessible name and announces its state', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('tab', { name: 'My own Bible file' }).click()

  // Named as the control it is, rather than by the surrounding
  // instructions.
  const picker = page.getByLabel('Choose a Bible file')
  await expect(picker).toBeAttached()

  // A live region exists to carry selecting/parsing/ready/failed states.
  const status = page.locator('bg-game-setup [role="status"]')
  await expect(status).toBeAttached()

  // Selecting a real file announces the filename, in full and with its
  // extension, once it is ready.
  await picker.setInputFiles('e2e/fixtures/genesis1-full.zip')
  await expect(status).toContainText('genesis1-full.zip', { timeout: 15_000 })
})

// Game progress and errors must reach a screen-reader user, not only a
// sighted one — see the "Semantics and screen readers" and "Game rounds
// and results" sections of docs/SCRUM/TODO/Feature.Accessibility.md.
test('round changes and feedback are announced during a game', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('.round')).toBeVisible()

  // A live region carries which round is in play.
  const status = page.locator('bg-app [role="status"]')
  await expect(status.first()).toBeAttached()
  await expect(status.first()).toContainText(/round 1/i)
})

test('a verse-loading failure is announced, not only shown', async ({ page }) => {
  // Fail the verse request so the error path renders.
  await page.route('**/api/verses/random*', (route) => route.fulfill({ status: 500, body: 'boom' }))

  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()

  // role="alert" rather than role="status": an error interrupts, and the
  // player cannot continue until it is dealt with.
  await expect(page.locator('bg-app [role="alert"]')).toBeVisible({ timeout: 10_000 })
})
