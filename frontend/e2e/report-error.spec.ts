import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Exercises docs/SCRUM/Feature.ErrorMessageBibleLoader.md: a failed Bible
// file upload shows a "Report this issue" flow that captures the error
// automatically and sends it (via the backend's /api/reports endpoint,
// which relays through SMTP — see MailSender.fs) once the player adds a
// short description.

test('uploading a bad file shows an error and lets the player report it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible', exact: false }).first().click()
  await page.getByRole('tab', { name: 'My own Bible file' }).click()

  // Upload something that isn't a real zip at all — triggers the "couldn't
  // open it as a zip" catch-block error path.
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures/not-a-zip.zip'))

  await expect(page.locator('.error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Report this issue' })).toBeVisible()

  await page.getByRole('button', { name: 'Report this issue' }).click()
  await page
    .getByPlaceholder(/Uploaded my NWT export/)
    .fill('Tried uploading a file I downloaded, it just showed an error immediately.')
  await page.getByRole('button', { name: 'Send report' }).click()

  await expect(page.getByText('✓ Thanks — your report was sent.')).toBeVisible({ timeout: 10_000 })
})

test('cancelling the report form collapses it back to the link', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'The Bible', exact: false }).first().click()
  await page.getByRole('tab', { name: 'My own Bible file' }).click()

  await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures/not-a-zip.zip'))
  await expect(page.locator('.error')).toBeVisible()

  await page.getByRole('button', { name: 'Report this issue' }).click()
  await expect(page.getByPlaceholder(/Uploaded my NWT export/)).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Report this issue' })).toBeVisible()
  await expect(page.getByPlaceholder(/Uploaded my NWT export/)).toHaveCount(0)
})
