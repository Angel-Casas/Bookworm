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

test('PDF mode toggle (paginated ↔ scroll) renders both modes and persists', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Default = paginated; one .pdf-reader__page in DOM
  await expect(page.locator('.pdf-reader__page')).toHaveCount(1);

  // Open prefs and switch to scroll mode
  await page.getByRole('button', { name: /reader preferences/i }).click();
  await page.getByRole('radio', { name: /scroll/i }).click();

  // 5 placeholders now exist
  await expect(page.locator('.pdf-reader__page')).toHaveCount(5);

  // Reload — scroll mode persists
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.pdf-reader__page')).toHaveCount(5);
});
