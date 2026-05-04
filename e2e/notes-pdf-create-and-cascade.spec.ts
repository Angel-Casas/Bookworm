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

test('PDF: select → 📝 → save note → delete highlight cascades note', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  const textLayer = page.locator('.pdf-reader__text-layer').first();
  await expect(textLayer).toBeVisible({ timeout: 10_000 });
  await expect(textLayer.locator('span').first()).toBeVisible({ timeout: 5000 });

  await textLayer.evaluate((layer) => {
    const span = layer.querySelector('span');
    const node = span?.firstChild;
    if (!node) throw new Error('no text node in text-layer');
    const range = document.createRange();
    const text = node.textContent ?? '';
    range.setStart(node, 0);
    range.setEnd(node, Math.min(text.length, 30));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.waitForTimeout(300);

  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });
  await toolbar.getByRole('button', { name: 'Add note' }).click();

  const editor = page.locator('.note-editor');
  await expect(editor).toBeVisible({ timeout: 2000 });
  await editor.getByRole('textbox').fill('PDF margin note');
  await page.locator('body').click({ position: { x: 10, y: 10 } });

  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(page.locator('.highlights-panel__note-line')).toContainText('PDF margin note');

  await page.getByRole('button', { name: 'Remove highlight' }).first().click();
  await expect(page.locator('.highlights-panel__item')).toHaveCount(0);
  await expect(page.locator('.highlights-panel__note-line')).toBeHidden();

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(page.getByText(/No highlights yet/i)).toBeVisible();
});
