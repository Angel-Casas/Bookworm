import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function configureApiKeyAndModel(page: Page): Promise<void> {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'gpt-x' }, { id: 'claude-y' }],
      }),
    });
  });
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-multi-excerpt');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();
  await page.getByRole('button', { name: /^gpt-x$/ }).click();
  await expect(page.getByRole('button', { name: /^gpt-x$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /back to library/i }).click();
}

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function openBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function selectTextInIframe(page: Page, charLen = 30): Promise<void> {
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  const tocCount = await tocEntries.count();
  await tocEntries.nth(Math.min(2, tocCount - 1)).click();
  await page.waitForTimeout(800);

  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body, len) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent?.trim().length ?? 0) > 5
        ) {
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
      range.setEnd(visible, Math.min(text.length, len));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, charLen);
  await page.waitForTimeout(300);
}

// Defensive — should never fire in any of the no-streaming scenarios below.
async function mockChatCompletions401(page: Page): Promise<void> {
  await page.route('https://nano-gpt.com/api/v1/chat/completions', (route: Route) =>
    route.fulfill({ status: 401, body: '' }),
  );
}

test.describe('Phase 5.5 — multi-excerpt mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const orig = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
        return orig.call(this, { ...init, mode: 'open' });
      };
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await mockChatCompletions401(page);
    await configureApiKeyAndModel(page);
    await importFixture(page);
    await openBook(page);
  });

  test('1. happy path — toolbar + Compare adds a selection-kind excerpt; chip appears in chat', async ({
    page,
  }) => {
    await selectTextInIframe(page, 30);

    // Toolbar appears with + Compare visible.
    const toolbar = page.locator('.highlight-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 3000 });
    const addToCompare = toolbar.getByRole('button', { name: /add to compare/i });
    await expect(addToCompare).toBeEnabled();
    await addToCompare.click();

    // Toolbar dismisses; chip appears in the chat panel.
    await expect(toolbar).toBeHidden({ timeout: 2000 });
    const chip = page.getByRole('status', { name: /compare excerpts/i });
    await expect(chip).toBeVisible({ timeout: 3000 });
    await expect(chip.getByRole('button', { name: /^1 excerpt/i })).toBeVisible();
  });

  test('2. clearing the tray empties the chip', async ({ page }) => {
    await selectTextInIframe(page, 30);
    await page.locator('.highlight-toolbar').getByRole('button', { name: /add to compare/i }).click();

    const chip = page.getByRole('status', { name: /compare excerpts/i });
    await expect(chip).toBeVisible({ timeout: 3000 });

    await chip.getByRole('button', { name: /clear compare set/i }).click();
    await expect(chip).toBeHidden();
  });

  test('3. expand chip → list shows excerpts; per-row × removes one', async ({ page }) => {
    // First excerpt
    await selectTextInIframe(page, 30);
    await page.locator('.highlight-toolbar').getByRole('button', { name: /add to compare/i }).click();
    await expect(page.locator('.highlight-toolbar')).toBeHidden();

    // Second excerpt — pick a different TOC entry to ensure a different anchor.
    const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
    const tocCount = await tocEntries.count();
    await tocEntries.nth(Math.min(3, tocCount - 1)).click();
    await page.waitForTimeout(800);
    await selectTextInIframe(page, 25);
    await page.locator('.highlight-toolbar').getByRole('button', { name: /add to compare/i }).click();

    // Wait for chip to update count.
    const chip = page.getByRole('status', { name: /compare excerpts/i });
    await expect(chip).toBeVisible();

    // Expand and verify there are 2 list items.
    const toggle = chip.getByRole('button', { name: /excerpt/i });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const listItems = chip.locator('.multi-excerpt-chip__item');
    await expect(listItems).toHaveCount(2);

    // Per-row × removes one item.
    await listItems.first().getByRole('button', { name: /remove from compare/i }).click();
    await expect(listItems).toHaveCount(1);
  });

  test('4. dedupe — selection kind: same range twice yields one tray entry', async ({ page }) => {
    await selectTextInIframe(page, 30);
    await page.locator('.highlight-toolbar').getByRole('button', { name: /add to compare/i }).click();
    await expect(page.locator('.highlight-toolbar')).toBeHidden();

    // Re-select the same range (same TOC entry, same charLen) and click again.
    await selectTextInIframe(page, 30);
    await page.locator('.highlight-toolbar').getByRole('button', { name: /add to compare/i }).click();

    // Chip should still report 1 excerpt (anchor-hash dedupe).
    const chip = page.getByRole('status', { name: /compare excerpts/i });
    await expect(chip).toBeVisible();
    await expect(chip.getByRole('button', { name: /^1 excerpt/i })).toBeVisible();
  });

  test('5. reload clears tray', async ({ page }) => {
    await selectTextInIframe(page, 30);
    await page.locator('.highlight-toolbar').getByRole('button', { name: /add to compare/i }).click();

    const chip = page.getByRole('status', { name: /compare excerpts/i });
    await expect(chip).toBeVisible({ timeout: 3000 });

    await page.reload();
    // After reload, key is gone (session-only) and the no-key empty state lands.
    // The chip is workspace state — it must not survive a reload regardless.
    await expect(page.getByRole('status', { name: /compare excerpts/i })).toBeHidden();
  });
});
