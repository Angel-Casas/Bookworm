import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createBookProfilesRepository } from './bookProfiles';
import {
  BookId,
  IsoTimestamp,
  type BookProfileRecord,
} from '@/domain';

let db: BookwormDB;

function makeRecord(overrides: Partial<BookProfileRecord> = {}): BookProfileRecord {
  return {
    bookId: BookId('b1'),
    profile: {
      summary: 'A short novel.',
      genre: 'classic literature',
      structure: 'fiction',
      themes: ['marriage', 'class'],
      keyEntities: {
        characters: ['Elizabeth Bennet'],
        concepts: ['pride'],
        places: ['Pemberley'],
      },
    },
    prompts: [
      { text: 'Track the evolving motives of Elizabeth.', category: 'analysis' },
      { text: 'Map the relationships between the Bennets.', category: 'structure' },
      { text: 'Identify scenes that foreshadow Darcy.', category: 'analysis' },
      { text: 'What does the title mean?', category: 'comprehension' },
    ],
    profileSchemaVersion: 1,
    generatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  const name = `test-bp-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  db = await openBookwormDB(name);
});

afterEach(() => {
  db.close();
});

describe('BookProfilesRepository', () => {
  it('put + get round-trips a record', async () => {
    const repo = createBookProfilesRepository(db);
    const r = makeRecord();
    await repo.put(r);
    const got = await repo.get(BookId('b1'));
    expect(got).not.toBeNull();
    expect(got?.profile.structure).toBe('fiction');
    expect(got?.prompts).toHaveLength(4);
    expect(got?.prompts[0]?.category).toBe('analysis');
  });

  it('get returns null for missing bookId', async () => {
    const repo = createBookProfilesRepository(db);
    expect(await repo.get(BookId('missing'))).toBeNull();
  });

  it('put twice updates (last writer wins)', async () => {
    const repo = createBookProfilesRepository(db);
    await repo.put(makeRecord({ profile: { ...makeRecord().profile, genre: 'first' } }));
    await repo.put(makeRecord({ profile: { ...makeRecord().profile, genre: 'second' } }));
    const got = await repo.get(BookId('b1'));
    expect(got?.profile.genre).toBe('second');
  });

  it('deleteByBook removes the record', async () => {
    const repo = createBookProfilesRepository(db);
    await repo.put(makeRecord());
    await repo.deleteByBook(BookId('b1'));
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('deleteByBook is a no-op on missing record', async () => {
    const repo = createBookProfilesRepository(db);
    await expect(repo.deleteByBook(BookId('missing'))).resolves.toBeUndefined();
  });

  it('countStaleVersions returns books with profileSchemaVersion < current', async () => {
    const repo = createBookProfilesRepository(db);
    await repo.put(makeRecord({ bookId: BookId('old'), profileSchemaVersion: 0 }));
    await repo.put(makeRecord({ bookId: BookId('cur'), profileSchemaVersion: 1 }));
    const stale = await repo.countStaleVersions(1);
    expect(stale).toContain(BookId('old'));
    expect(stale).not.toContain(BookId('cur'));
  });

  it('get filters malformed records (validating reads)', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    await tx.store.put({
      bookId: 'b1',
      profile: 'not-an-object',
      prompts: [],
      profileSchemaVersion: 1,
      generatedAt: '2026-05-06T00:00:00.000Z',
    } as unknown as BookProfileRecord);
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('get filters records with invalid prompt category', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    const bad = makeRecord();
    await tx.store.put({
      ...bad,
      prompts: [{ text: 'x', category: 'not-a-category' }],
    } as unknown as BookProfileRecord);
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('get filters records with invalid structure', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    const bad = makeRecord();
    await tx.store.put({
      ...bad,
      profile: { ...bad.profile, structure: 'not-a-structure' },
    } as unknown as BookProfileRecord);
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('get filters records with more than 8 prompts', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    const bad = makeRecord();
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      text: `q${String(i)}`,
      category: 'analysis' as const,
    }));
    await tx.store.put({
      ...bad,
      prompts: tooMany,
    });
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });
});
