import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('delete a bookmark and confirm it stays gone after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Navigate to a TOC entry past the cover so bookmarks land on text content.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  const tocCount = await tocEntries.count();
  await tocEntries.nth(Math.min(2, tocCount - 1)).click();
  await page.waitForTimeout(500);

  const addBtn = page.getByRole('button', { name: /add bookmark/i });
  await addBtn.click();
  await page.waitForTimeout(300);
  await addBtn.click();
  await page.waitForTimeout(300);

  await page.getByRole('tab', { name: /bookmarks/i }).click();
  const rows = page.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(2);

  await rows.first().hover();
  await rows.first().getByRole('button', { name: /remove bookmark/i }).click();

  await expect(rows).toHaveCount(1);

  // Allow the IDB delete to flush before reloading.
  await page.waitForTimeout(500);

  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /bookmarks/i }).click();
  await expect(rows).toHaveCount(1);
});
