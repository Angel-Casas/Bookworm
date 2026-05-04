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

async function selectVisibleText(page: Page): Promise<void> {
  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 5) {
          allText.push(node as Text);
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      walk(body);
      const visible = allText.find((t) => {
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= win.innerWidth &&
          rect.top >= 0 &&
          rect.top <= win.innerHeight
        );
      });
      if (!visible) throw new Error('No visible text node found');
      const range = document.createRange();
      const text = visible.textContent;
      range.setStart(visible, 0);
      range.setEnd(visible, Math.min(text.length, 30));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  await page.waitForTimeout(300);
}

test('notebook supports inline note edit + bookmark delete', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Add bookmark' }).click();
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);
  await selectVisibleText(page);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(2);

  await page.getByRole('button', { name: /add note/i }).first().click();
  await page.locator('.note-editor textarea').fill('inline thought');
  // Save via Shift+Enter shortcut (more deterministic than click-outside in iframe-heavy DOM).
  await page.locator('.note-editor textarea').press('Shift+Enter');
  await expect(page.locator('.notebook-row__note-line')).toContainText('inline thought', {
    timeout: 5000,
  });

  await page.getByRole('button', { name: /remove bookmark/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);

  // Allow async IDB writes to flush before reload.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to reader/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.notebook-row')).toHaveCount(1);
  await expect(page.locator('.notebook-row__note-line')).toContainText('inline thought');
});
