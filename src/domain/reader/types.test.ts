import { describe, it, expect } from 'vitest';
import type { LocationAnchor } from '@/domain';
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from './types';

// Compile-time exhaustiveness — adding a new variant without updating the
// switch will produce a TS error here.
function describeAnchor(anchor: LocationAnchor): string {
  switch (anchor.kind) {
    case 'epub-cfi':
      return `epub:${anchor.cfi}`;
    case 'pdf':
      return `pdf:${String(anchor.page)}`;
    default: {
      const _exhaustive: never = anchor;
      return _exhaustive;
    }
  }
}

describe('LocationAnchor (reused from @/domain)', () => {
  it('round-trips through exhaustive switch', () => {
    const epub: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' };
    const pdf: LocationAnchor = { kind: 'pdf', page: 12 };
    expect(describeAnchor(epub)).toBe('epub:epubcfi(/6/4)');
    expect(describeAnchor(pdf)).toBe('pdf:12');
  });
});

describe('DEFAULT_READER_PREFERENCES', () => {
  it('declares sensible mobile-first defaults', () => {
    const p: ReaderPreferences = DEFAULT_READER_PREFERENCES;
    expect(p.theme).toBe('light');
    expect(p.modeByFormat.epub).toBe('paginated');
    expect(p.typography.fontSizeStep).toBe(2);
    expect(p.typography.fontFamily).toBe('system-serif');
  });
});
