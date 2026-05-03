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

test('resize across 768px breakpoint swaps rail ↔ sheet pattern', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Desktop = rail visible, no TOC button in chrome
  await expect(page.locator('aside.desktop-rail')).toBeVisible();
  await expect(page.getByRole('button', { name: /table of contents/i })).toBeHidden();

  // Resize to mobile width
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('aside.desktop-rail')).toBeHidden();
  await expect(page.getByRole('button', { name: /table of contents/i })).toBeVisible();

  // Resize back to desktop
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('aside.desktop-rail')).toBeVisible();
  await expect(page.getByRole('button', { name: /table of contents/i })).toBeHidden();
});
