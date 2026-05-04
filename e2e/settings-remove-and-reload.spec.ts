import { test, expect } from '@playwright/test';

test('Settings: save key, remove, reload — Settings shows fresh entry form', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-removable');
  await page.getByRole('button', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('hunter2');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /^remove$/i }).click();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeHidden();
});
