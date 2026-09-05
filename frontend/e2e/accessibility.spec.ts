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
