import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('opens an imported PDF and navigates the TOC', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 1 of 5/);

  // On desktop the TOC lives in the always-visible left rail
  const rail = page.locator('aside.desktop-rail');
  await expect(rail).toBeVisible();
  const tocEntries = rail.locator('button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  expect(await tocEntries.count()).toBe(5);
  await tocEntries.nth(2).click();

  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 3 of 5/);
});
