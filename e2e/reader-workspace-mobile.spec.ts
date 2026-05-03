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

test('mobile workspace: no rail, bottom sheet for TOC and typography', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // No rail in mobile viewport
  await expect(page.locator('aside.desktop-rail')).toBeHidden();

  // Tap ☰ → TOC sheet
  await page.getByRole('button', { name: /table of contents/i }).click();
  const tocSheet = page.getByRole('dialog');
  await expect(tocSheet).toBeVisible();
  await expect(tocSheet.locator('aside.toc-panel')).toBeVisible();

  // Tap scrim to dismiss — click near the top so we hit the area not
  // covered by the bottom-anchored sheet (60vh).
  await page.locator('.mobile-sheet__scrim').click({ position: { x: 50, y: 50 } });
  await expect(tocSheet).toBeHidden();

  // Tap ⚙ → Typography sheet
  await page.getByRole('button', { name: /reader preferences/i }).click();
  const typoSheet = page.getByRole('dialog');
  await expect(typoSheet).toBeVisible();
  await expect(typoSheet.locator('section.typography-panel')).toBeVisible();

  // Press Escape to dismiss
  await page.keyboard.press('Escape');
  await expect(typoSheet).toBeHidden();
});
