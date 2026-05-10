import { expect, test } from '@playwright/test';

// Motion-token regression net. Three checks:
//  1. The four duration tokens are exposed on :root and resolve to a time.
//  2. The three easing tokens are exposed on :root and resolve to cubic-bezier.
//  3. No element on the page carries a literal `Nms` or `cubic-bezier(...)`
//     in its inline `style` attribute. After 6.1.2 migration this should
//     hold across every rendered surface.

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
    const CUBIC = /^cubic-bezier\(/;
    expect(eases.out).toMatch(CUBIC);
    expect(eases.inOut).toMatch(CUBIC);
    expect(eases.spring).toMatch(CUBIC);
  });

  test('no element on the page carries literal ms or cubic-bezier in its inline style', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    const offending = await page.evaluate(() => {
      const LITERAL_MS = /\b\d+(?:\.\d+)?ms\b/;
      const CUBIC_BEZIER = /cubic-bezier\s*\(/;
      const els = Array.from(document.querySelectorAll<HTMLElement>('[style]'));
      return els
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          cls: el.getAttribute('class') ?? '',
          style: el.getAttribute('style') ?? '',
        }))
        .filter(
          (e) => LITERAL_MS.test(e.style) || CUBIC_BEZIER.test(e.style),
        );
    });

    expect(offending, JSON.stringify(offending, null, 2)).toEqual([]);
  });
});
