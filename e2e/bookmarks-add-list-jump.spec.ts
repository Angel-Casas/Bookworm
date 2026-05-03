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

test('add a bookmark, see it in the rail Bookmarks tab, jump to it, and survive reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Navigate into the first chapter so the bookmark lands on a section
  // with text (the cover is intentionally text-empty).
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  // Skip the cover/title entries — pick the first deeper-content entry
  const tocCount = await tocEntries.count();
  await tocEntries.nth(Math.min(2, tocCount - 1)).click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /add bookmark/i }).click();

  // Switch the rail to the Bookmarks tab
  await page.getByRole('tab', { name: /bookmarks/i }).click();

  const rows = page.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(1);

  await expect(rows.first().locator('.bookmarks-panel__section')).toBeVisible();

  // Snippet patches in within ~1.5s
  await expect(rows.first().locator('.bookmarks-panel__snippet')).toBeVisible({ timeout: 1500 });

  await rows.first().getByRole('button').first().click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /bookmarks/i }).click();
  await expect(rows).toHaveCount(1);
});
