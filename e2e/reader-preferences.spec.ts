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

test('typography + theme preferences persist across reload', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Open typography panel
  await page.getByRole('button', { name: /reader preferences/i }).click();
  const typoPanel = page.locator('section.typography-panel');
  await expect(typoPanel).toBeVisible();

  // Switch to dark theme
  await typoPanel.getByRole('radio', { name: /dark/i }).click();

  // Increase font size once
  await typoPanel.getByRole('button', { name: /increase font size/i }).click();

  await page.waitForTimeout(300);

  // Reader root reflects dark theme
  const readerRoot = page.locator('.reader-view');
  await expect(readerRoot).toHaveAttribute('data-reader-theme', 'dark');

  // Reload — reader still dark
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.reader-view')).toHaveAttribute('data-reader-theme', 'dark');
});
