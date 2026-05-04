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

test('select → 📝 → editor opens; typing + blur saves; persists across reload', async ({
  page,
}) => {
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

  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);

  await selectVisibleText(page);
  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });

  await toolbar.getByRole('button', { name: 'Add note' }).click();

  const editor = page.locator('.reader-workspace__note-editor-overlay .note-editor');
  await expect(editor).toBeVisible({ timeout: 2000 });
  const textarea = editor.getByRole('textbox');
  await expect(textarea).toBeFocused();

  await textarea.fill('Bingley represents the new gentry.');
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await expect(editor).toBeHidden({ timeout: 2000 });

  await page.getByRole('tab', { name: /highlights/i }).click();
  const noteLine = page.locator('.highlights-panel__note-line');
  await expect(noteLine).toBeVisible();
  await expect(noteLine).toHaveText(/Bingley represents the new gentry/);

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(page.locator('.highlights-panel__note-line')).toContainText(
    /Bingley represents the new gentry/,
  );
});
