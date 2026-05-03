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

test('PDF mode toggle (paginated ↔ scroll) renders both modes and persists', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Default = paginated; one .pdf-reader__page in DOM
  await expect(page.locator('.pdf-reader__page')).toHaveCount(1);

  // Open prefs and switch to scroll mode
  await page.getByRole('button', { name: /reader preferences/i }).click();
  await page.getByRole('radio', { name: /scroll/i }).click();

  // 5 placeholders now exist
  await expect(page.locator('.pdf-reader__page')).toHaveCount(5);

  // Reload — scroll mode persists
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.pdf-reader__page')).toHaveCount(5);
});

test('paginated mode keeps exactly one page slot in the DOM after multiple Next clicks', async ({
  page,
}) => {
  // Regression: PdfPageView.destroy() removes its canvas + text-layer but NOT
  // the parent slot div (the adapter owns that). Without explicit cleanup,
  // every Next click left an empty slot behind, drifting the visible page
  // off-screen after a few clicks.
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.pdf-reader__page')).toHaveCount(1);

  // Click Next four times — should still have exactly one slot
  for (let i = 0; i < 4; i += 1) {
    await page.locator('button[data-action="next"]').click();
    await expect(page.locator('.pdf-reader__page')).toHaveCount(1);
  }

  // Final indicator: page 5
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 5 of 5/);
  // The visible canvas should have non-zero width (page actually rendered).
  // Render is async after the slot mount; poll until pixels arrive.
  await expect
    .poll(
      () =>
        page.locator('canvas').first().evaluate((el) => (el as HTMLCanvasElement).width),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0);
});
