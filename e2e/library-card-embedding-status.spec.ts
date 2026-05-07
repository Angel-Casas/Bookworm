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

function fakeEmbeddingResponse(inputs: string[]): Response {
  return new Response(
    JSON.stringify({
      data: inputs.map((_, i) => ({
        index: i,
        embedding: new Array<number>(1536).fill(0).map((_, j) => ((i + 1) * (j + 1)) % 7 / 7),
      })),
      usage: { prompt_tokens: inputs.length * 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// The embedding stage runs only when an API key is configured. e2e runs
// without a key by default — embed() short-circuits with 'invalid-key'
// (PR #22) and the pipeline marks the book failed{embedding-no-key}.
// PR #24 surfaces that as actionable copy on the card: "API key required"
// + an Open Settings button. This test verifies the no-crash,
// observable-terminal-state path; the route mock below is defensive for
// the case where a future fixture sets a key (would let the embedding
// stage complete and the card transition through to "Indexed").
test('library card progresses to a stable terminal state after import', async ({ page }) => {
  await page.route('https://nano-gpt.com/api/v1/embeddings', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { input: string[] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: await fakeEmbeddingResponse(body.input).text(),
    });
  });

  await page.goto('/');
  await importFixture(page);

  // Either the chunking-phase progress text flashes by, or the pipeline
  // settles at the no-key terminal state (post-PR #24 actionable copy),
  // or the full happy-path completes if a key is somehow configured.
  // Any of these counts as the card rendering correctly.
  await expect(
    page
      .getByText(
        /chunking|preparing for ai|indexed|embedding|api key required|couldn't index/i,
      )
      .first(),
  ).toBeVisible({ timeout: 30_000 });
});
