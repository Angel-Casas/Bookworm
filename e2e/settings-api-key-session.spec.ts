import { test, expect } from '@playwright/test';

test('Settings: paste key, "Use this session", see status card, Remove', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-session-key');
  const submit = page.locator('button[type="submit"]');
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText(/using api key for this session/i)).toBeVisible();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/remove api key/i);
    void dialog.accept();
  });
  await page.getByRole('button', { name: /^remove$/i }).click();

  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
});
