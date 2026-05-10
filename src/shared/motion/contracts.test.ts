import { describe, it, expect } from 'vitest';
import {
  assertNoLiteralMotion,
  assertNoLocalReducedMotionBlock,
  assertReducedMotionZeroesTokens,
} from './contracts';

describe('assertNoLiteralMotion', () => {
  it('accepts a tokenized declaration', () => {
    const src = `
      .motion-fade-in {
        animation: bw-fade-in var(--duration-base) var(--ease-out);
      }
    `;
    expect(() => {
      assertNoLiteralMotion(src);
    }).not.toThrow();
  });

  it('rejects a literal millisecond value', () => {
    const src = `.x { transition: opacity 250ms ease-out; }`;
    expect(() => {
      assertNoLiteralMotion(src);
    }).toThrow(/literal duration/i);
  });

  it('rejects a literal cubic-bezier', () => {
    const src = `.x { transition: opacity var(--duration-base) cubic-bezier(0.4, 0, 0.2, 1); }`;
    expect(() => {
      assertNoLiteralMotion(src);
    }).toThrow(/cubic-bezier/i);
  });

  it('rejects a bare ease keyword', () => {
    const src = `.x { transition: opacity var(--duration-base) ease; }`;
    expect(() => {
      assertNoLiteralMotion(src);
    }).toThrow(/bare easing keyword/i);
  });

  it('does not flag the keyword "ease" inside an --ease-* var name', () => {
    const src = `.x { animation: foo var(--duration-base) var(--ease-spring); }`;
    expect(() => {
      assertNoLiteralMotion(src);
    }).not.toThrow();
  });
});

describe('assertReducedMotionZeroesTokens', () => {
  it('accepts a block that zeroes all four duration tokens', () => {
    const src = `
      @media (prefers-reduced-motion: reduce) {
        :root {
          --duration-fast: 0ms;
          --duration-base: 0ms;
          --duration-slow: 0ms;
          --duration-slower: 0ms;
        }
      }
    `;
    expect(() => {
      assertReducedMotionZeroesTokens(src);
    }).not.toThrow();
  });

  it('rejects a block missing one of the duration tokens', () => {
    const src = `
      @media (prefers-reduced-motion: reduce) {
        :root {
          --duration-fast: 0ms;
          --duration-base: 0ms;
          --duration-slow: 0ms;
        }
      }
    `;
    expect(() => {
      assertReducedMotionZeroesTokens(src);
    }).toThrow(/--duration-slower/);
  });

  it('rejects when a duration token is not 0ms inside the block', () => {
    const src = `
      @media (prefers-reduced-motion: reduce) {
        :root {
          --duration-fast: 0ms;
          --duration-base: 0ms;
          --duration-slow: 0ms;
          --duration-slower: 100ms;
        }
      }
    `;
    expect(() => {
      assertReducedMotionZeroesTokens(src);
    }).toThrow(/--duration-slower/);
  });

  it('rejects when no reduced-motion @media block is present', () => {
    const src = `:root { --duration-fast: 120ms; }`;
    expect(() => {
      assertReducedMotionZeroesTokens(src);
    }).toThrow(/prefers-reduced-motion/);
  });
});

describe('assertNoLocalReducedMotionBlock', () => {
  it('accepts a file without any reduced-motion block', () => {
    const src = `.x { color: red; }`;
    expect(() => {
      assertNoLocalReducedMotionBlock(src);
    }).not.toThrow();
  });

  it('rejects a file containing a reduced-motion block', () => {
    const src = `
      .x { animation: y var(--duration-base); }
      @media (prefers-reduced-motion: reduce) {
        .x { animation: none; }
      }
    `;
    expect(() => {
      assertNoLocalReducedMotionBlock(src);
    }).toThrow(/local @media \(prefers-reduced-motion/i);
  });
});
