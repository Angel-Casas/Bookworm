import type { HighlightColor } from '@/domain/annotations/types';

// Display order used by the toolbar and the list panel's per-row color picker.
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
];

export const COLOR_HEX: Readonly<Record<HighlightColor, string>> = {
  yellow: '#fef08a',
  green: '#bbf7d0',
  blue: '#bfdbfe',
  pink: '#fbcfe8',
};
