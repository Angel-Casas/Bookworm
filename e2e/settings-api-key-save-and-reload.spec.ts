import { test, expect } from '@playwright/test';

test('Settings: save on device → reload locked → unlock with passphrase', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-saved-key');
  await page.getByRole('button', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('correct horse battery staple');

  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });

  await page.reload();
  // Locked state — UnlockForm rendered with passphrase field + Unlock button.
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByLabel(/^passphrase$/i)).toBeVisible();

  await page.getByLabel(/^passphrase$/i).fill('wrong-passphrase');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByText(/wrong passphrase/i)).toBeVisible({ timeout: 8_000 });

  await page.getByLabel(/^passphrase$/i).fill('correct horse battery staple');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });
});
