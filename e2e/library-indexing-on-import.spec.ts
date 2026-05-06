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

test('indexing kicks off on import; status transitions to ready; inspector link appears', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  // Status indicator transitions through chunking → ready. Use a generous
  // timeout because foliate-js's headless parse + chunking takes a few seconds
  // for the fixture book.
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /open index inspector/i })).toBeVisible();
});
