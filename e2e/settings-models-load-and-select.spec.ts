import { test, expect } from '@playwright/test';

test('Settings/Models: enter key, list loads, section hides without session key after reload', async ({
  page,
}) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'gpt-x' }, { id: 'claude-y' }, { id: 'gemini-z' }],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-models');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();

  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^claude-y$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^gemini-z$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^gpt-x$/ })).toBeVisible();

  await page.getByRole('button', { name: /^claude-y$/ }).click();
  await expect(page.getByRole('button', { name: /^claude-y$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.reload();
  // Section is hidden after reload (no session key); catalog snapshot persists in IDB.
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();
});
