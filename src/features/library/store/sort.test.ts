import { describe, expect, it } from 'vitest';
import { compareBooks } from './sort';
import { BookId, IsoTimestamp, type Book } from '@/domain';

const make = (over: Partial<Book> & Pick<Book, 'id' | 'title' | 'createdAt'>): Book => ({
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: 'p',
    originalName: 'p',
    byteSize: 0,
    mimeType: 'application/epub+zip',
    checksum: 'x'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  updatedAt: over.createdAt,
  ...over,
});

const t = (s: string) => IsoTimestamp(s);

describe('compareBooks', () => {
  it('sorts by recently-opened with never-opened to the bottom', () => {
    const opened = make({
      id: BookId('a'),
      title: 'A',
      createdAt: t('2024-01-01T00:00:00Z'),
      lastOpenedAt: t('2024-05-02T00:00:00Z'),
    });
    const never = make({ id: BookId('b'), title: 'B', createdAt: t('2024-04-01T00:00:00Z') });
    const result = [never, opened].sort(compareBooks('recently-opened'));
    expect(result.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('sorts by recently-added desc', () => {
    const older = make({ id: BookId('a'), title: 'A', createdAt: t('2024-01-01T00:00:00Z') });
    const newer = make({ id: BookId('b'), title: 'B', createdAt: t('2024-04-01T00:00:00Z') });
    expect([older, newer].sort(compareBooks('recently-added')).map((b) => b.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('sorts by title locale-compare', () => {
    const z = make({ id: BookId('z'), title: 'Zebra', createdAt: t('2024-01-01T00:00:00Z') });
    const a = make({ id: BookId('a'), title: 'apple', createdAt: t('2024-01-01T00:00:00Z') });
    expect([z, a].sort(compareBooks('title')).map((b) => b.title)).toEqual(['apple', 'Zebra']);
  });

  it('sorts by author with missing authors last', () => {
    const named = make({
      id: BookId('a'),
      title: 'A',
      author: 'Beta',
      createdAt: t('2024-01-01T00:00:00Z'),
    });
    const noauthor = make({ id: BookId('b'), title: 'B', createdAt: t('2024-01-01T00:00:00Z') });
    expect([noauthor, named].sort(compareBooks('author')).map((b) => b.id)).toEqual(['a', 'b']);
  });
});
