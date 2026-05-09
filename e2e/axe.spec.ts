import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

// Phase 6 a11y baselines captured 2026-05-09 against `main`. These count
// `serious` + `critical` impact axe violations only — `minor` and `moderate`
// are inspected during the audit (PR-C) but not gated here.
//
// Increases mean we regressed; decreases mean Phase 6.2 implementation work
// improved a11y, in which case the relevant constant should be lowered to
// match the new baseline so future regressions stay visible.
const BASELINE_LIBRARY_EMPTY_SERIOUS_OR_CRITICAL = 0;
// `library with imported book` baseline = 0 — F2.1 fixed in PR-G (Phase 6.2);
// import-tray text now uses --color-text-muted (passes WCAG AA at ~7:1).
const BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL = 0;
// Reader baselines lowered from 1 → 0 in PR-C after fixing aria-prohibited-attr
// on .reader-view__mount (F2.2 inline fix).
const BASELINE_READER_DEFAULT_SERIOUS_OR_CRITICAL = 0;
const BASELINE_READER_HIGHLIGHTS_TAB_SERIOUS_OR_CRITICAL = 0;

async function seriousOrCriticalCount(builder: AxeBuilder): Promise<number> {
  const result = await builder.analyze();
  return result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  ).length;
}

async function importBook(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function openBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 10_000,
  });
}

test.describe('Phase 6 a11y baseline', () => {
  test('library empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_LIBRARY_EMPTY_SERIOUS_OR_CRITICAL);
  });

  test('library with imported book', async ({ page }) => {
    await page.goto('/');
    await importBook(page);
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL);
  });

  test('reader default view (chat right rail + desktop rail)', async ({ page }) => {
    await page.goto('/');
    await importBook(page);
    await openBook(page);
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_READER_DEFAULT_SERIOUS_OR_CRITICAL);
  });

  test('reader with Highlights tab active', async ({ page }) => {
    await page.goto('/');
    await importBook(page);
    await openBook(page);
    await page.getByRole('tab', { name: /highlights/i }).click();
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_READER_HIGHLIGHTS_TAB_SERIOUS_OR_CRITICAL);
  });
});
