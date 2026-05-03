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

test('mobile: ★ adds; ☰ opens tabbed sheet; tap bookmark dismisses + navigates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /add bookmark/i }).click();

  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  await sheet.getByRole('tab', { name: /bookmarks/i }).click();
  const rows = sheet.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(1);

  await rows.first().getByRole('button').first().click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
});
