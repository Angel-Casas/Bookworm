import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');
const PDF = resolve(process.cwd(), 'test-fixtures/text-friendly.pdf');

test('search filters books and shows no-match state', async ({ page }) => {
  await page.goto('/');

  const fc1 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await fc1).setFiles([PG_EPUB, PDF]);

  const shelf = page.locator('.bookshelf__grid');
  await expect(shelf.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(shelf.getByText(/text-friendly/i).first()).toBeVisible({ timeout: 30_000 });

  // Wait for tray to clear so its file-name labels don't pollute search assertions.
  await page.waitForTimeout(2500);

  const search = page.getByRole('searchbox', { name: /search/i });
  await search.fill('prejudice');
  await expect(shelf.getByText(/text-friendly/i)).toHaveCount(0);
  await expect(shelf.getByText(/pride and prejudice/i).first()).toBeVisible();

  await search.fill('zzznothing');
  await expect(page.getByText(/no books match/i)).toBeVisible();
});

test('sort selection persists across reloads', async ({ page }) => {
  await page.goto('/');

  const fc = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await fc).setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

  const sort = page.getByLabel('Sort');
  await sort.selectOption('title');
  // Sort persistence is debounced 200ms; give it room before the reload.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByLabel('Sort')).toHaveValue('title');
});
