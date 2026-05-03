import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';

describe('Bookmark', () => {
  it('has the v1 shape with nullable snippet and sectionTitle', () => {
    const b: Bookmark = {
      id: BookmarkId('00000000-0000-0000-0000-000000000001'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(b.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(b.snippet).toBeNull();
    expect(b.sectionTitle).toBeNull();
  });

  it('accepts a populated bookmark with snippet + section title', () => {
    const b: Bookmark = {
      id: BookmarkId('id-2'),
      bookId: BookId('book-2'),
      anchor: { kind: 'pdf', page: 7 },
      snippet: 'It is a truth universally acknowledged…',
      sectionTitle: 'Page 7',
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(b.snippet).toContain('truth');
    expect(b.sectionTitle).toBe('Page 7');
  });
});
