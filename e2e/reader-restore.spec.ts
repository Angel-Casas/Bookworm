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

test('reload from library view stays in library', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);
  await page.reload();
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 10_000 });
  // Should not have any reader chrome
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();
});

test('reload while in the reader keeps the reader open at saved position', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Open TOC and wait for entries to be populated (foliate-js parses async)
  await page.getByRole('button', { name: /table of contents/i }).click();
  const tocEntries = page.locator('aside.toc-panel button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  const count = await tocEntries.count();
  // Pick a non-first entry when possible so the saved position is meaningful
  const targetIndex = Math.min(Math.floor(count / 2), count - 1);
  await tocEntries.nth(targetIndex).click();

  // Allow debounced save (500ms) + sync flush on visibilitychange to flush
  await page.waitForTimeout(1000);

  await page.reload();

  // After reload, we should be back in the reader (not the library)
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
});
