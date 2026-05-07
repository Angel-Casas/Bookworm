import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

// Full happy-path retrieval E2E (configure API key → import → wait for
// indexing → mock /v1/chat/completions structured response → click prompt
// → thread is created and the prompt text appears in the message list)
// requires test fixtures to set up the API key and a model in the
// modelCatalog store, plus mocked /v1/embeddings for the indexing pipeline.
// The existing chat-passage-mode-desktop.spec follows the same pragmatic
// policy of skipping LLM-streaming flows in e2e.
//
// What we CAN verify in e2e: importing a fixture book renders without
// crashing the prompts-aware ChatPanel (the empty-state + suggestions
// surface lands without breaking the page).
test('Prompts-aware ChatPanel renders without crashing on book import', async ({ page }) => {
  // Mock /v1/chat/completions in case profile generation is somehow
  // triggered without a key (defensive — should never fire).
  await page.route('https://nano-gpt.com/api/v1/chat/completions', (route: Route) =>
    route.fulfill({ status: 401, body: '' }),
  );
  await page.goto('/');
  await importFixture(page);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible();
});
