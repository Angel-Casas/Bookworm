import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

// Phase 6 offline behavior baseline. Tests assert *current* behavior so the
// spec is green; surprises become 6.4 findings in PR-C. Where the audit found
// no current implementation of a behavior we expect, the test is annotated
// `test.fail()` and the gap is recorded as a finding.

async function importBook(page: Page): Promise<void> {
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

async function configureApiKeyAndModel(page: Page): Promise<void> {
  // Fulfill the /models call so settings can save.
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'gpt-x' }],
      }),
    });
  });
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-offline');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();
  await page.getByRole('button', { name: /^gpt-x$/ }).click();
  await page.getByRole('button', { name: /back to library/i }).click();
}

test.describe('Phase 6 offline behavior baseline', () => {
  test('cold-offline: app shell loads from SW cache after reload', async ({ page, context }) => {
    // Prime: visit once online so SW installs and precaches assets.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');

    // First-load pages are not always controlled by the SW (Chrome only routes
    // through SW on subsequent navigations). Reload once so this page comes
    // under SW control with primed precache.
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    );

    // Now go offline and reload again. SW should serve the shell from cache.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('mid-session-offline: imported book renders from IndexedDB', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await importBook(page);

    // Go offline mid-session.
    await context.setOffline(true);

    // Open the book — content lives in IndexedDB, should render without
    // network. Asserting via the "Back to library" button which only appears
    // once the reader has mounted successfully.
    await page.getByRole('button', { name: /open pride and prejudice/i }).click();
    await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('api-down: chat send surfaces error rather than hanging', async ({ page, context }) => {
    await page.goto('/');
    await configureApiKeyAndModel(page);
    await importBook(page);
    await openBook(page);

    // Block the chat completions endpoint at the network layer.
    await context.route('https://nano-gpt.com/api/v1/chat/completions', (route) =>
      route.abort('failed'),
    );

    // ChatPanel renders the no-threads empty state on first visit even when
    // key+model are configured. Click into a draft to surface the composer.
    // The button label depends on whether suggested-prompts loaded; both
    // variants accept the same click — match either.
    const startDraft = page
      .getByRole('button', { name: /(start a conversation|start a blank conversation)/i })
      .first();
    await startDraft.click();

    const composer = page.locator('.chat-composer__textarea');
    await expect(composer).toBeVisible({ timeout: 5_000 });
    await composer.fill('what is this book about');
    await page.getByRole('button', { name: /^Send$/ }).click();

    // Within a generous timeout an error bubble should render. ChatErrorBubble
    // uses role="alert" and contains a Retry button.
    const errorBubble = page.getByRole('alert').first();
    await expect(errorBubble).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /retry/i }).first()).toBeVisible();
  });
});
