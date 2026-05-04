import { test, expect } from '@playwright/test';

test('Settings: open from library chrome, persist across reload, close back', async ({ page }) => {
  await page.goto('/');

  const settingsBtn = page.getByRole('button', { name: /open settings/i });
  await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
  await settingsBtn.click();

  await expect(page.getByRole('heading', { name: /settings/i, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /api key/i, level: 2 })).toBeVisible();

  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: /api key/i, level: 2 })).toBeVisible();

  await page.getByRole('button', { name: /back to library/i }).click();
  await expect(page.getByRole('button', { name: /open settings/i })).toBeVisible();
});
