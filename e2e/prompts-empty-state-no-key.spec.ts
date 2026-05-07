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

async function openImportedBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
}

// Suggested prompts are gated by api-key + selected-model state. With no
// key configured (the default fixture state) the no-key empty state wins
// and prompts are not rendered.
test('Suggested prompts are hidden when no API key is configured', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);
  await openImportedBook(page);

  await expect(page.getByText(/set up your api key/i)).toBeVisible();
  await expect(page.getByRole('region', { name: /suggested questions/i })).toHaveCount(0);
});
