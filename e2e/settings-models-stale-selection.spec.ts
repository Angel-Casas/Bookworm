import { test, expect } from '@playwright/test';

test('Settings/Models: selection that disappears on refresh shows stale notice', async ({
  page,
}) => {
  // Call 1 = validateKey, call 2 = auto-refresh, call 3 = manual Refresh.
  let calls = 0;
  await page.route('**/api/v1/models', async (route) => {
    calls += 1;
    const body =
      calls <= 2
        ? { data: [{ id: 'keep-me' }, { id: 'will-vanish' }] }
        : { data: [{ id: 'keep-me' }, { id: 'new-arrival' }] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-stale');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^will-vanish$/ })).toBeVisible();

  await page.getByRole('button', { name: /^will-vanish$/ }).click();
  await expect(page.getByRole('button', { name: /^will-vanish$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: /^refresh$/i }).click();

  await expect(page.getByText(/will-vanish/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/no longer available/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^new-arrival$/ })).toBeVisible();

  await page.getByRole('button', { name: /^keep-me$/ }).click();
  await expect(page.getByText(/no longer available/i)).toBeHidden();
  await expect(page.getByRole('button', { name: /^keep-me$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
