import { test, expect } from '@playwright/test';

test('shows the Bookworm empty-state landing on first visit', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
  await expect(page.getByText('A quiet place to read books')).toBeVisible();
  await expect(page.getByText('Your books stay on this device')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a book to begin.' })).toBeVisible();

  expect(consoleErrors, `unexpected console/page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
