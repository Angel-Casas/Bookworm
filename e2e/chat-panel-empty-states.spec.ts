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

async function openImportedBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
}

test('chat panel: shows no-key empty state on first run; navigates to settings', async ({
  page,
}) => {
  await page.goto('/');
  await importFixture(page);
  await openImportedBook(page);

  // Right rail should be visible by default; chat panel renders no-key state.
  await expect(page.getByText(/set up your api key/i)).toBeVisible();
  await page.getByRole('button', { name: /open settings/i }).first().click();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
});

test('chat panel: collapsing the rail and re-expanding via edge tab', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);
  await openImportedBook(page);

  // Collapse the rail.
  await page.getByLabel('Collapse chat panel').click();
  // The collapsed edge tab is visible and exposes the expand affordance.
  await expect(page.getByLabel('Expand chat panel')).toBeVisible();
  // Re-expand.
  await page.getByLabel('Expand chat panel').click();
  await expect(page.getByLabel('Collapse chat panel')).toBeVisible();
});
