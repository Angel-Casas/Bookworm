import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertNoLiteralMotion,
  assertReducedMotionZeroesTokens,
} from '@/shared/motion/contracts';

const here = dirname(fileURLToPath(import.meta.url));
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
