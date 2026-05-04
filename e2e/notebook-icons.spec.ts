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

test('icons: chrome notebook button + toolbar/panel note buttons render SVGs (no 📝 emoji)', async ({
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

  const notebookBtn = page.getByRole('button', { name: /open notebook/i });
  await expect(notebookBtn.locator('svg.icon')).toHaveCount(1);
  expect((await notebookBtn.textContent()) ?? '').not.toContain('📝');
  expect((await notebookBtn.textContent()) ?? '').not.toContain('📓');

  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);
  await selectVisibleText(page);
  const toolbarNoteBtn = page
    .locator('.highlight-toolbar')
    .getByRole('button', { name: /add note/i });
  await expect(toolbarNoteBtn.locator('svg.icon')).toHaveCount(1);
  expect((await toolbarNoteBtn.textContent()) ?? '').not.toContain('📝');

  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();

  await page.getByRole('tab', { name: /highlights/i }).click();
  const panelNoteBtn = page.getByRole('button', { name: /add note/i }).first();
  await expect(panelNoteBtn.locator('svg.icon')).toHaveCount(1);
  expect((await panelNoteBtn.textContent()) ?? '').not.toContain('📝');
});
