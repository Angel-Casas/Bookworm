import { test, expect } from '@playwright/test';

test('Settings: chrome icons are SVGs, not emoji glyphs', async ({ page }) => {
  await page.goto('/');

  const gearBtn = page.getByRole('button', { name: /open settings/i });
  await expect(gearBtn).toBeVisible({ timeout: 15_000 });
  await expect(gearBtn.locator('svg.icon')).toHaveCount(1);
  expect((await gearBtn.textContent()) ?? '').not.toContain('⚙');
  expect((await gearBtn.textContent()) ?? '').not.toContain('🛠');

  await gearBtn.click();

  const backBtn = page.getByRole('button', { name: /back to library/i });
  await expect(backBtn.locator('svg.icon')).toHaveCount(1);

  const showToggle = page.getByRole('button', { name: /show api key/i });
  await expect(showToggle.locator('svg.icon')).toHaveCount(1);

  await showToggle.click();
  const hideToggle = page.getByRole('button', { name: /hide api key/i });
  await expect(hideToggle.locator('svg.icon')).toHaveCount(1);
});
