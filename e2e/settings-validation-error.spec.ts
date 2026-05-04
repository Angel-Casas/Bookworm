import { test, expect } from '@playwright/test';

test('Settings: 401 from /v1/models blocks save; 200 then succeeds', async ({ page }) => {
  let allowSuccess = false;
  await page.route('**/api/v1/models', async (route) => {
    if (allowSuccess) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid api key' }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-bad');
  await page.locator('button[type="submit"]').click();

  await expect(page.getByText(/rejected by nanogpt/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/using api key for this session/i)).toBeHidden();

  allowSuccess = true;
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-good');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();
});
