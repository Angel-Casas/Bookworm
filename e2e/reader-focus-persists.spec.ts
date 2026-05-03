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

test('focus mode persists across reload — no chrome flash', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Enter focus mode
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();

  // Allow the focus-mode preference write to flush to IDB
  await page.waitForTimeout(300);

  // Reload — workspace must re-mount in focus mode from first paint
  await page.reload();

  const workspace = page.locator('.reader-workspace');
  await expect(workspace).toBeVisible({ timeout: 15_000 });

  await expect(workspace).toHaveAttribute('data-mode', 'focus');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();
});
