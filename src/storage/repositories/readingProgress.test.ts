import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createReadingProgressRepository } from './readingProgress';
import type { LocationAnchor } from '@/domain';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-readprog-${crypto.randomUUID()}`);
});

describe('readingProgressRepository', () => {
  it('round-trips an EPUB CFI anchor', async () => {
    const repo = createReadingProgressRepository(db);
    const anchor: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/14!/4/22/2/4)' };
    await repo.put('book-1', anchor);
    expect(await repo.get('book-1')).toEqual(anchor);
  });

  it('returns undefined for unknown bookId', async () => {
    const repo = createReadingProgressRepository(db);
    expect(await repo.get('nope')).toBeUndefined();
  });

  it('isolates progress per book', async () => {
    const repo = createReadingProgressRepository(db);
    const a: LocationAnchor = { kind: 'epub-cfi', cfi: 'cfi-a' };
    const b: LocationAnchor = { kind: 'epub-cfi', cfi: 'cfi-b' };
    await repo.put('book-a', a);
    await repo.put('book-b', b);
    expect(await repo.get('book-a')).toEqual(a);
    expect(await repo.get('book-b')).toEqual(b);
  });

  it('delete() removes a record', async () => {
    const repo = createReadingProgressRepository(db);
    await repo.put('book-1', { kind: 'epub-cfi', cfi: 'x' });
    await repo.delete('book-1');
    expect(await repo.get('book-1')).toBeUndefined();
  });

  it('returns undefined and self-heals when a stored record fails validation', async () => {
    const repo = createReadingProgressRepository(db);
    // Inject a corrupted record bypassing the typed API
    await db.put('reading_progress', {
      bookId: 'broken',
      anchor: { kind: 'unknown-format' } as unknown as LocationAnchor,
      updatedAt: Date.now(),
    });
    expect(await repo.get('broken')).toBeUndefined();
    // After read, the corrupted record should have been deleted
    const raw = await db.get('reading_progress', 'broken');
    expect(raw).toBeUndefined();
  });

  it('listKeys returns all stored bookIds', async () => {
    const repo = createReadingProgressRepository(db);
    await repo.put('a', { kind: 'epub-cfi', cfi: 'x' });
    await repo.put('b', { kind: 'epub-cfi', cfi: 'y' });
    const keys = [...(await repo.listKeys())].sort();
    expect(keys).toEqual(['a', 'b']);
  });
});
