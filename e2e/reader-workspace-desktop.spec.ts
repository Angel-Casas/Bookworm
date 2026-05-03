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

test('desktop workspace: rail visible, focus mode hides chrome + rail, hover reveals chrome', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Default: rail visible
  await expect(page.locator('aside.desktop-rail')).toBeVisible();

  // Click a TOC entry in the rail — should not break the chrome
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  await tocEntries.first().click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();

  // Press F to enter focus mode
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();
  await expect(page.locator('aside.desktop-rail')).toBeHidden();

  // Move cursor to the top to reveal chrome
  await page.mouse.move(640, 5);
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 1500,
  });

  // Stop moving — the hide timer fires after HIDE_DELAY_MS regardless of
  // whether the cursor is over the iframe (which swallows mousemove events).
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden({
    timeout: 3000,
  });

  // Press Escape to exit focus mode
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
  await expect(page.locator('aside.desktop-rail')).toBeVisible();
});
