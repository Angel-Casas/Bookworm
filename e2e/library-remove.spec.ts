import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('removes a book and it stays gone after reload', async ({ page }) => {
  await page.goto('/');

  const fc = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await fc).setFiles(PG_EPUB);

  // Cards (and only cards) carry data-book-id. Counting on that avoids
  // matching the cover-fallback title text that appears on cover-less books.
  const cards = page.locator('[data-book-id]');
  await expect(cards).toHaveCount(1, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Book actions' }).first().click();
  await page.getByRole('menuitem', { name: /remove from library/i }).click();
  await expect(cards).toHaveCount(0);

  // The remove handler is fire-and-forget at the click layer; let the IDB
  // delete settle before reloading so the book doesn't reappear from a stale
  // record on next boot.
  await page.waitForTimeout(500);

  await page.reload();
  await expect(page.locator('[data-book-id]')).toHaveCount(0);
});
