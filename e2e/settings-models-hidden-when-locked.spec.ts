import { test, expect } from '@playwright/test';

test('Settings/Models: hidden when key is locked; reappears on unlock', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'mm-1' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-locked');
  await page.getByRole('button', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('lock-pp');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeVisible();

  // Reload → locked → no section.
  await page.reload();
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();

  // Unlock → section returns.
  await page.getByLabel(/^passphrase$/i).fill('lock-pp');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.getByRole('button', { name: /^mm-1$/ })).toBeVisible();
});
