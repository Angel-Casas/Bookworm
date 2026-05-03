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

test('removing a book deletes its bookmarks (re-import shows empty list)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /add bookmark/i }).click();
  // Allow the bookmark IDB write + cascade delete writes to settle later.
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /back to library/i }).click();

  const cards = page.locator('[data-book-id]');
  await expect(cards).toHaveCount(1, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Book actions' }).first().click();
  await page.getByRole('menuitem', { name: /remove from library/i }).click();
  await expect(cards).toHaveCount(0);

  // Allow the cascade delete to complete before re-importing.
  await page.waitForTimeout(500);

  await importFixture(page);
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('tab', { name: /bookmarks/i }).click();
  await expect(page.getByText(/No bookmarks yet/i)).toBeVisible();
});
