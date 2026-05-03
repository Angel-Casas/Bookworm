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

test('back from reader returns to library with bookshelf intact', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  // Open the book
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Back to library
  await page.getByRole('button', { name: /back to library/i }).click();

  // Bookshelf renders with the imported card present
  await expect(page.getByRole('button', { name: /open pride and prejudice/i })).toBeVisible({
    timeout: 5_000,
  });

  // Reader chrome is gone
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();
});
