import { expect, test } from '@playwright/test';

// Phase 6.1.1 baseline: only verify that the four duration tokens are
// declared on :root and resolve to a valid time string. The stricter
// "no element on the page has inline literal motion" check is intentionally
// deferred to 6.1.2 — the migration PR — when the codebase is fully on
// tokens. Adding it here would gate this PR on pre-existing inline
// `animationDelay: 'Nms'` declarations in `LibraryEmptyState.tsx` that
// 6.1.2 will eliminate.

test.describe('motion tokens', () => {
  test('document-level CSS variables expose the four duration tokens', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    const tokens = await page.evaluate(() => {
      const cs = window.getComputedStyle(document.documentElement);
      return {
        fast: cs.getPropertyValue('--duration-fast').trim(),
        base: cs.getPropertyValue('--duration-base').trim(),
        slow: cs.getPropertyValue('--duration-slow').trim(),
        slower: cs.getPropertyValue('--duration-slower').trim(),
      };
    });
    // Browsers may normalize `120ms` to `.12s` or `0.12s`; accept any
    // standard time literal that ends in `ms` or `s`.
    const TIME = /^\d*\.?\d+(?:ms|s)$/;
    expect(tokens.fast).toMatch(TIME);
    expect(tokens.base).toMatch(TIME);
    expect(tokens.slow).toMatch(TIME);
    expect(tokens.slower).toMatch(TIME);
  });

  test('document-level CSS variables expose the three easing tokens', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    const eases = await page.evaluate(() => {
      const cs = window.getComputedStyle(document.documentElement);
      return {
        out: cs.getPropertyValue('--ease-out').trim(),
        inOut: cs.getPropertyValue('--ease-in-out').trim(),
        spring: cs.getPropertyValue('--ease-spring').trim(),
      };
    });
    // Each easing should be a non-empty cubic-bezier(...) declaration.
    const CUBIC = /^cubic-bezier\(/;
    expect(eases.out).toMatch(CUBIC);
    expect(eases.inOut).toMatch(CUBIC);
    expect(eases.spring).toMatch(CUBIC);
  });
});
