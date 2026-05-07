import { test, expect } from '@playwright/test';

// Without a configured key the chat panel is in the no-key state. Without
// chunks the panel also can't render prompts. This spec is a smoke check
// that the panel renders (no crash) with no key and no imported book.
// Full no-chunks coverage (key configured + book without text) requires
// fixture infrastructure deferred to Phase 6.5 polish.
test('Empty library renders without crashing the chat surface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import a book to begin.' })).toBeVisible();
});
