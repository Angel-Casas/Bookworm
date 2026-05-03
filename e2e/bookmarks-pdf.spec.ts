import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('PDF bookmark shows page-based section title and snippet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  await tocEntries.nth(2).click();
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 3 of 5/);

  await page.getByRole('button', { name: /add bookmark/i }).click();

  await page.getByRole('tab', { name: /bookmarks/i }).click();
  const rows = page.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.bookmarks-panel__section')).not.toBeEmpty();
  await expect(rows.first().locator('.bookmarks-panel__snippet')).toBeVisible({ timeout: 1500 });
});
