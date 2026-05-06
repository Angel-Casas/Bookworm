import { test, expect, type Page } from '@playwright/test';
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
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-passage-mode');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();
  await page.getByRole('button', { name: /^gpt-x$/ }).click();
  await expect(page.getByRole('button', { name: /^gpt-x$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Close settings — navigate back to library.
  await page.getByRole('button', { name: /back to library/i }).click();
}

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({
    timeout: 15_000,
  });
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

test.describe('passage mode (desktop)', () => {
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
  });

  test('Ask AI is visible in the highlight toolbar when key + model are configured', async ({
    page,
  }) => {
    await configureApiKeyAndModel(page);
    await importFixture(page);
    await openBook(page);
    await selectTextInIframe(page);

    const toolbar = page.locator('.highlight-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 3000 });
    await expect(toolbar.getByRole('button', { name: /ask ai about this passage/i })).toBeVisible();
  });

  test('Click Ask AI → chip appears in chat panel with the selection text + composer auto-focuses', async ({
    page,
  }) => {
    await configureApiKeyAndModel(page);
    await importFixture(page);
    await openBook(page);
    await selectTextInIframe(page);

    // Click Ask AI in the highlight toolbar.
    const toolbar = page.locator('.highlight-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 3000 });
    await toolbar.getByRole('button', { name: /ask ai about this passage/i }).click();

    // Chip materializes in the chat panel.
    const chip = page.getByRole('status', { name: /attached passage/i });
    await expect(chip).toBeVisible({ timeout: 3000 });

    // Composer textarea is focused (the workspace's composerFocusRef fires on
    // the next render after Ask AI dispatches).
    const composer = page.locator('.chat-composer__textarea');
    await expect(composer).toBeFocused();
  });

  test('Dismissing the chip via ✕ removes it', async ({ page }) => {
    await configureApiKeyAndModel(page);
    await importFixture(page);
    await openBook(page);
    await selectTextInIframe(page);

    const toolbar = page.locator('.highlight-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 3000 });
    await toolbar.getByRole('button', { name: /ask ai about this passage/i }).click();

    const chip = page.getByRole('status', { name: /attached passage/i });
    await expect(chip).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: /dismiss attached passage/i }).click();
    await expect(chip).toBeHidden();
  });

  // The send → assistant-with-source-footer → click footer → reader-navigates
  // path requires mocking the streaming /api/v1/chat/completions endpoint
  // with SSE chunks. The current e2e harness has no SSE mock helper; building
  // one is its own task. Coverage of the underlying logic exists in:
  //   - useChatSend.test.ts (passage-mode prompt + contextRef asymmetry)
  //   - MessageBubble.test.tsx (source-footer rendering + click anchor)
  //   - PrivacyPreview.test.tsx (snapshot equivalence with prompt assembly)
  // Manual-smoke is required for the full flow before declaring 4.4 complete
  // (see spec §16).
  test.skip('TODO send → assistant has source footer → click jumps reader to anchor (needs SSE mock harness)', () => {
    // Implement once /api/v1/chat/completions can be mocked with streaming
    // SSE responses. See e2e/settings-models-load-and-select.spec.ts for the
    // route() pattern used for non-streaming JSON; SSE needs a body stream
    // built from text-encoder chunks.
  });
});
