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

// Phase 4.4: HighlightToolbar's "Ask AI" button is gated by both the api-key
// state (must be session/unlocked) and a non-empty selectedModelId. With no
// key configured (the default fixture state), the gate is closed regardless
// of model — so the Ask AI button must be hidden even when the user makes a
// selection in the reader.
test('Ask AI button is hidden when no API key is configured', async ({ page }) => {
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
  await openImportedBook(page);

  // Navigate to a chapter with text.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  const tocCount = await tocEntries.count();
  await tocEntries.nth(Math.min(2, tocCount - 1)).click();
  await page.waitForTimeout(800);

  // Programmatically select 30 chars of a visible text node inside the iframe.
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

  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });
  // Color swatches render normally; only Ask AI is gated.
  await expect(toolbar.getByRole('button', { name: 'yellow' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /ask ai/i })).toHaveCount(0);
});
