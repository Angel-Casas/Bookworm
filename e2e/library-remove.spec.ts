import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('removes a book and it stays gone after reload', async ({ page }) => {
  await page.goto('/');

  const fc = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await fc).setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Book actions' }).first().click();
  await page.getByRole('menuitem', { name: /remove from library/i }).click();
  await expect(page.getByText(/pride and prejudice/i)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(/pride and prejudice/i)).toHaveCount(0);
});
