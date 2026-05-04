import { test, expect } from '@playwright/test';

test('Settings/Models: removing the API key cascades to catalog + selection', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'm-1' }, { id: 'm-2' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-cascade');
  await page.getByRole('button', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('cascade-pp');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });

  await expect(page.getByRole('button', { name: /^m-1$/ })).toBeVisible();
  await page.getByRole('button', { name: /^m-1$/ }).click();
  await expect(page.getByRole('button', { name: /^m-1$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The selection's IDB write is fire-and-forget from the click handler.
  // Give it a moment to flush before the reload tears the page down.
  await page.waitForTimeout(200);

  // Reload — boot hydrates catalog + selection + locked key state.
  await page.reload();
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();

  // Unlock — section reappears with selection still highlighted.
  await page.getByLabel(/^passphrase$/i).fill('cascade-pp');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });
  // Wait for the auto-refresh after unlock to settle (loading → ready).
  await expect(page.getByText(/^updated /i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: /^m-1$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Remove key with confirmation.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /^remove$/i }).click();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();

  // Reload — catalog/selection are gone (no leftover).
  await page.reload();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();
});
