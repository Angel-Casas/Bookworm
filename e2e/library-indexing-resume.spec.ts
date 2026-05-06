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

test('reload during indexing → resume completes → no chunk duplication after rebuild', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  // Wait for status to enter "Indexing" before reloading. If we miss the
  // chunking window (e.g., it completes very fast), we'll just observe ready
  // immediately on reload — that's also fine; the resume scan is a no-op
  // when the book is already ready.
  await Promise.race([
    expect(page.getByText(/indexing/i)).toBeVisible({ timeout: 30_000 }),
    expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 30_000 }),
  ]);

  await page.reload();

  // Whatever the state was at reload, indexing should converge to ready.
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });

  // Read the chunk count from the inspector.
  await page.getByRole('button', { name: /open index inspector/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const summary1 = await page.locator('.index-inspector__summary').textContent();

  // Rebuild and re-read. Determinism: the rebuild's chunker version is the
  // same as the original's, so chunk count + section count + total tokens
  // should be byte-equal in the summary text.
  await page.getByRole('button', { name: /rebuild index/i }).click();
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /open index inspector/i }).click();
  const summary2 = await page.locator('.index-inspector__summary').textContent();

  expect(summary2).toBe(summary1);
});
