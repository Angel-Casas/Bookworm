import { describe, it, expect } from 'vitest';
import { COLOR_HEX, HIGHLIGHT_COLORS } from './highlightColors';
import type { HighlightColor } from '@/domain/annotations/types';

describe('highlightColors', () => {
  it('exports a hex value for every HighlightColor', () => {
    const expected: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
    for (const color of expected) {
      expect(COLOR_HEX[color]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('HIGHLIGHT_COLORS lists the four colors in display order', () => {
    expect(HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'blue', 'pink']);
  });
});
