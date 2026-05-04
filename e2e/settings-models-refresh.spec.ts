import { test, expect } from '@playwright/test';

test('Settings/Models: clicking Refresh re-fetches and updates the list', async ({ page }) => {
  // Call 1 = validateKey, call 2 = auto-refresh after key entry, call 3 = manual Refresh.
  let calls = 0;
  await page.route('**/api/v1/models', async (route) => {
    calls += 1;
    const body =
      calls <= 2
        ? { data: [{ id: 'a' }, { id: 'b' }] }
        : { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-refresh');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^a$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^c$/ })).toBeHidden();

  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByRole('button', { name: /^c$/ })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: /^d$/ })).toBeVisible();
});
