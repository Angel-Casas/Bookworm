import {
  BookId,
  IsoTimestamp,
  type BookProfile,
  type BookProfileRecord,
  type BookStructure,
  type SuggestedPrompt,
  type SuggestedPromptCategory,
} from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_PROFILES_STORE } from '../db/schema';

export type BookProfilesRepository = {
  get(bookId: BookId): Promise<BookProfileRecord | null>;
  put(record: BookProfileRecord): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
};

const VALID_STRUCTURES: ReadonlySet<BookStructure> = new Set([
  'fiction',
  'nonfiction',
  'textbook',
  'reference',
]);

const VALID_CATEGORIES: ReadonlySet<SuggestedPromptCategory> = new Set([
  'comprehension',
  'analysis',
  'structure',
  'creative',
  'study',
]);

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function normalizeProfile(value: unknown): BookProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.summary !== 'string') return null;
  if (typeof p.genre !== 'string') return null;
  if (typeof p.structure !== 'string') return null;
  if (!VALID_STRUCTURES.has(p.structure as BookStructure)) return null;
  if (!isStringArray(p.themes)) return null;
  if (typeof p.keyEntities !== 'object' || p.keyEntities === null) return null;
  const ke = p.keyEntities as Record<string, unknown>;
  if (!isStringArray(ke.characters)) return null;
  if (!isStringArray(ke.concepts)) return null;
  if (!isStringArray(ke.places)) return null;
  return {
    summary: p.summary,
    genre: p.genre,
    structure: p.structure as BookStructure,
    themes: p.themes,
    keyEntities: {
      characters: ke.characters,
      concepts: ke.concepts,
      places: ke.places,
    },
  };
}

function normalizePrompt(value: unknown): SuggestedPrompt | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.text !== 'string' || p.text === '') return null;
  if (typeof p.category !== 'string') return null;
  if (!VALID_CATEGORIES.has(p.category as SuggestedPromptCategory)) return null;
  return { text: p.text, category: p.category as SuggestedPromptCategory };
}

function normalizeRecord(value: unknown): BookProfileRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  const profile = normalizeProfile(r.profile);
  if (profile === null) return null;
  if (!Array.isArray(r.prompts)) return null;
  if (r.prompts.length > 8) return null;
  const prompts = r.prompts.map(normalizePrompt);
  if (prompts.some((p) => p === null)) return null;
  if (typeof r.profileSchemaVersion !== 'number' || !Number.isInteger(r.profileSchemaVersion)) {
    return null;
  }
  if (typeof r.generatedAt !== 'string') return null;
  return {
    bookId: BookId(r.bookId),
    profile,
    prompts: prompts as readonly SuggestedPrompt[],
    profileSchemaVersion: r.profileSchemaVersion,
    generatedAt: IsoTimestamp(r.generatedAt),
  };
}

export function createBookProfilesRepository(db: BookwormDB): BookProfilesRepository {
  return {
    async get(bookId) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readonly');
      const raw = await tx.store.get(bookId);
      return raw === undefined ? null : normalizeRecord(raw);
    },
    async put(record) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readwrite');
      await tx.store.put(record);
      await tx.done;
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readwrite');
      await tx.store.delete(bookId);
      await tx.done;
    },
    async countStaleVersions(currentVersion) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readonly');
      const stale = new Set<BookId>();
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const r = normalizeRecord(cursor.value);
        if (r !== null && r.profileSchemaVersion < currentVersion) {
          stale.add(r.bookId);
        }
        cursor = await cursor.continue();
      }
      return [...stale];
    },
  };
}
