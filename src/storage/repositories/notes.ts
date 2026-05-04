import { BookId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { LocationAnchor } from '@/domain';
import type { Note, NoteAnchorRef } from '@/domain/annotations/types';
import type { BookwormDB } from '../db/open';
import { NOTES_STORE } from '../db/schema';

export type NotesRepository = {
  upsert(note: Note): Promise<void>;
  delete(id: NoteId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Note[]>;
  getByHighlight(highlightId: HighlightId): Promise<Note | null>;
  deleteByHighlight(highlightId: HighlightId): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
};

function isValidLocationAnchor(value: unknown): value is LocationAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'epub-cfi') return typeof (value as { cfi?: unknown }).cfi === 'string';
  if (v.kind === 'pdf') return typeof (value as { page?: unknown }).page === 'number';
  return false;
}

function isValidAnchorRef(value: unknown): value is NoteAnchorRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'highlight') {
    return typeof (value as { highlightId?: unknown }).highlightId === 'string';
  }
  if (v.kind === 'location') {
    return isValidLocationAnchor((value as { anchor?: unknown }).anchor);
  }
  return false;
}

function normalizeNote(record: unknown): Note | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Note>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidAnchorRef(r.anchorRef)) return null;
  if (typeof r.content !== 'string') return null;
  if (typeof r.createdAt !== 'string') return null;
  if (typeof r.updatedAt !== 'string') return null;
  return {
    id: NoteId(r.id),
    bookId: BookId(r.bookId),
    anchorRef: r.anchorRef,
    content: r.content,
    createdAt: IsoTimestamp(r.createdAt),
    updatedAt: IsoTimestamp(r.updatedAt),
  };
}

export function createNotesRepository(db: BookwormDB): NotesRepository {
  return {
    async upsert(note) {
      await db.put(NOTES_STORE, note);
    },
    async delete(id) {
      await db.delete(NOTES_STORE, id);
    },
    async listByBook(bookId) {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      return records.map(normalizeNote).filter((n): n is Note => n !== null);
    },
    async getByHighlight(highlightId) {
      const found = await db.getFromIndex(NOTES_STORE, 'by-highlight', highlightId);
      if (!found) return null;
      return normalizeNote(found);
    },
    async deleteByHighlight(highlightId) {
      const found = await db.getFromIndex(NOTES_STORE, 'by-highlight', highlightId);
      if (!found) return;
      await db.delete(NOTES_STORE, (found as Note).id);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
