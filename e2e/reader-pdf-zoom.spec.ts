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

test('PDF zoom changes canvas size and persists across reload', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  const widthBefore = await page
    .locator('canvas')
    .first()
    .evaluate((el) => (el as HTMLCanvasElement).width);

  // Open prefs and increase zoom
  await page.getByRole('button', { name: /reader preferences/i }).click();
  await page.getByRole('button', { name: /increase font size/i }).click();
  await page.getByRole('button', { name: /increase font size/i }).click();

  // Allow re-render
  await page.waitForTimeout(800);

  const widthAfter = await page
    .locator('canvas')
    .first()
    .evaluate((el) => (el as HTMLCanvasElement).width);
  expect(widthAfter).toBeGreaterThan(widthBefore);

  // Reload; zoom persists
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  const widthAfterReload = await page
    .locator('canvas')
    .first()
    .evaluate((el) => (el as HTMLCanvasElement).width);
  expect(widthAfterReload).toBe(widthAfter);
});
