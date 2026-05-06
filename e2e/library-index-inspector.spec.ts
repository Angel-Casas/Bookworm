import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importAndWaitForReady(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
}

test('opening the inspector lists chunks; row expands; rebuild round-trips through chunking → ready', async ({ page }) => {
  await page.goto('/');
  await importAndWaitForReady(page);

  await page.getByRole('button', { name: /open index inspector/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/\d+ chunks · \d+ sections/)).toBeVisible();

  // Click the first row to expand it.
  const firstRow = page.locator('.index-inspector__chunk-row').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await expect(firstRow).toHaveAttribute('aria-expanded', 'true');

  // Click rebuild → modal closes → status flips back to chunking → returns
  // to ready.
  await page.getByRole('button', { name: /rebuild index/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
});
