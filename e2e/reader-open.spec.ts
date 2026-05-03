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

test('opens an imported EPUB and navigates the TOC', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  // Click the imported book's card → reader opens
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Open TOC sheet
  await page.getByRole('button', { name: /table of contents/i }).click();
  const tocPanel = page.locator('aside.toc-panel');
  await expect(tocPanel).toBeVisible();

  // The fixture EPUB has chapters; expect at least one entry
  const tocEntries = tocPanel.locator('button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  const count = await tocEntries.count();
  expect(count).toBeGreaterThan(0);

  // Click the first entry — sheet closes, no errors thrown
  await tocEntries.first().click();
  await expect(tocPanel).toBeHidden({ timeout: 2000 });
});
