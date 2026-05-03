import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');
const TXT = resolve(process.cwd(), 'test-fixtures/not-a-book.txt');

test('imports an EPUB end-to-end and persists across reload', async ({ page }) => {
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);

  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible();
});

test('refuses a plain text file with a tray entry', async ({ page }) => {
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(TXT);

  await expect(page.getByText(/not a supported format/i)).toBeVisible({ timeout: 5_000 });
});

test('detects duplicate on second import of the same file', async ({ page }) => {
  await page.goto('/');

  const first = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await first).setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

  const second = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '+ Import' }).click();
  await (await second).setFiles(PG_EPUB);

  await expect(page.getByText(/already in your library/i)).toBeVisible({ timeout: 5_000 });
});
