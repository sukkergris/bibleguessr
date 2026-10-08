import { test, expect } from '@playwright/test'

// The help under the Bible-file dropzone — see docs/web/local-bible-files:
// where to download a file, and which files the parsers can read.

test('the file picker says where to get a Bible file and which files work', async ({ page }) => {
  await page.goto('/play/the-bible')
  await page.getByRole('tab', { name: 'My own Bible file' }).click()

  const link = page.getByRole('link', { name: "jw.org's Bible page (opens in a new tab)" })
  await expect(link).toHaveAttribute('href', 'https://www.jw.org/en/library/bible/')
  await expect(link).toHaveAttribute('target', '_blank')

  await expect(page.getByText('download the EPUB of the 2013 revision')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: '.epub' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: '.zip' })).toContainText('Danish RTF export')
  await expect(page.getByText("PDF files can't be used.")).toBeVisible()
})
