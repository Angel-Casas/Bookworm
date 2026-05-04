import { test, expect } from '@playwright/test';

test('Settings/Models: full error state with no cache; recovery loads list', async ({ page }) => {
  let call = 0;
  await page.route('**/api/v1/models', async (route) => {
    call += 1;
    if (call === 1) {
      // The validateKey call from 4.1 — must succeed so we get past key entry.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    } else if (call === 2) {
      // The auto-refresh after key entry — fail (network).
      await route.abort('failed');
    } else {
      // Manual refresh — succeed.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'recovered' }] }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-no-cache');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();

  // Auto-refresh fails — full error state visible (validateKey returned empty `data`,
  // so there's no cached snapshot from boot or prior refresh).
  await expect(page.getByText(/couldn['’]t reach nanogpt/i)).toBeVisible({ timeout: 5_000 });

  // Manual refresh recovers.
  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByRole('button', { name: /^recovered$/ })).toBeVisible({ timeout: 5_000 });
});
