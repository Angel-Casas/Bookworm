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

test('mobile: select text → toolbar → color → ☰ → Highlights tab → tap row → reader navigates', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- we re-call via .call(this) below
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Open ☰ to switch to a chapter via TOC.
  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const tocEntries = sheet.locator('aside.toc-panel button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  await tocEntries.nth(2).click();
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(800);

  await selectVisibleText(page);

  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });
  await toolbar.getByRole('button', { name: 'blue' }).click();
  await page.waitForTimeout(400);

  // Open ☰ → switch to Highlights tab.
  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet2 = page.getByRole('dialog');
  await expect(sheet2).toBeVisible();
  await sheet2.getByRole('tab', { name: /highlights/i }).click();

  const rows = sheet2.locator('aside.highlights-panel li.highlights-panel__item');
  await expect(rows).toHaveCount(1);

  // Tap the row → sheet dismisses, reader stays.
  await rows.first().getByRole('button').first().click();
  await expect(sheet2).toBeHidden();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
});
