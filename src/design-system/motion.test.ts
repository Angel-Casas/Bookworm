import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertNoLiteralMotion,
  assertNoLocalReducedMotionBlock,
  assertReducedMotionZeroesTokens,
} from '@/shared/motion/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const motionCss = readFileSync(resolve(here, 'motion.css'), 'utf8');
const tokensCss = readFileSync(resolve(here, 'tokens.css'), 'utf8');

const PRIMITIVE_CLASSES = [
  '.motion-fade-in',
  '.motion-rise',
  '.motion-sheet-in',
  '.motion-scrim-in',
  '.motion-toast-in',
  '.motion-pulse',
  '.motion-rule-grow',
  '.motion-breath',
  '.motion-hover-bg',
  '.motion-press',
] as const;

const MIGRATED_CSS_FILES = [
  'features/reader/reader-chrome.css',
  'features/reader/workspace/mobile-sheet.css',
  'features/reader/workspace/workspace.css',
  'features/library/library-empty-state.css',
  'features/library/import/import-tray.css',
  'features/library/drop-overlay.css',
  'features/ai/prompts/suggested-prompts.css',
  'features/ai/chat/message-bubble.css',
  'pwa/sw-toast.css',
  'features/ai/chat/thread-list.css',
  'features/reader/workspace/right-rail.css',
  'features/library/library-chrome.css',
  'features/library/book-card.css',
] as const;

describe('motion.css contracts', () => {
  it('uses no literal durations or easings', () => {
    expect(() => {
      assertNoLiteralMotion(motionCss);
    }).not.toThrow();
  });

  it.each(PRIMITIVE_CLASSES)('declares a rule for %s', (cls) => {
    expect(motionCss).toContain(`${cls} {`);
  });
});

describe('tokens.css reduced-motion contract', () => {
  it('zeroes all four --duration-* tokens under prefers-reduced-motion', () => {
    expect(() => {
      assertReducedMotionZeroesTokens(tokensCss);
    }).not.toThrow();
  });
});

describe('migrated CSS files', () => {
  it.each(MIGRATED_CSS_FILES)('%s has no literal motion strings', (rel) => {
    const src = readFileSync(resolve(repoRoot, rel), 'utf8');
    expect(() => {
      assertNoLiteralMotion(src);
    }).not.toThrow();
  });

  it.each(MIGRATED_CSS_FILES)(
    '%s has no local reduced-motion block',
    (rel) => {
      const src = readFileSync(resolve(repoRoot, rel), 'utf8');
      expect(() => {
        assertNoLocalReducedMotionBlock(src);
      }).not.toThrow();
    },
  );
});
