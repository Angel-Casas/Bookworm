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

test('notebook empty states: no-entries and no-matches', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.getByText(/no annotations yet/i)).toBeVisible();

  await page.getByRole('button', { name: /back to reader/i }).click();
  await page.getByRole('button', { name: 'Add bookmark' }).click();
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);

  await page.getByRole('searchbox').fill('zzzzz-no-match');
  await page.waitForTimeout(250);
  await expect(page.getByText(/no matches/i)).toBeVisible();
});
