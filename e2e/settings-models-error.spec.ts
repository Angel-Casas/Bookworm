import { test, expect } from '@playwright/test';

test('Settings/Models: refresh failure with cache shows inline banner; recovery clears it', async ({
  page,
}) => {
  // Call 1 = validateKey, call 2 = auto-refresh (both succeed → cached snapshot).
  // Call 3 = manual Refresh (500 → cached banner).
  // Call 4 = recovery Refresh (200 → fresh list).
  let calls = 0;
  await page.route('**/api/v1/models', async (route) => {
    calls += 1;
    if (calls <= 2) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'cached-1' }, { id: 'cached-2' }] }),
      });
    } else if (calls === 3) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'cached-1' }, { id: 'cached-2' }, { id: 'fresh' }] }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-cached-error');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^cached-1$/ })).toBeVisible();

  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByText(/last-known list/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: /^cached-1$/ })).toBeVisible();

  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByRole('button', { name: /^fresh$/ })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/last-known list/i)).toBeHidden();
});
