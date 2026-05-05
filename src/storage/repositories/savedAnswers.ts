import {
  BookId,
  ChatMessageId,
  ChatThreadId,
  IsoTimestamp,
  SavedAnswerId,
} from '@/domain';
import type { ChatMode, ContextRef, SavedAnswer } from '@/domain';
import type { BookwormDB } from '../db/open';
import { SAVED_ANSWERS_STORE } from '../db/schema';

export type SavedAnswersRepository = {
  upsert(answer: SavedAnswer): Promise<void>;
  getById(id: SavedAnswerId): Promise<SavedAnswer | null>;
  getByMessage(messageId: ChatMessageId): Promise<SavedAnswer | null>;
  listByBook(bookId: BookId): Promise<readonly SavedAnswer[]>;
  delete(id: SavedAnswerId): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
};

const MODES: readonly ChatMode[] = [
  'open',
  'passage',
  'chapter',
  'multi-excerpt',
  'retrieval',
  'full-book',
];

function normalizeSavedAnswer(record: unknown): SavedAnswer | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<SavedAnswer>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  if (typeof r.threadId !== 'string' || r.threadId === '') return null;
  if (typeof r.messageId !== 'string' || r.messageId === '') return null;
  if (typeof r.modelId !== 'string' || r.modelId === '') return null;
  if (typeof r.mode !== 'string' || !MODES.includes(r.mode)) return null;
  if (typeof r.content !== 'string') return null;
  if (typeof r.question !== 'string') return null;
  if (!Array.isArray(r.contextRefs)) return null;
  if (typeof r.createdAt !== 'string') return null;
  if (r.userNote !== undefined && typeof r.userNote !== 'string') return null;
  return {
    id: SavedAnswerId(r.id),
    bookId: BookId(r.bookId),
    threadId: ChatThreadId(r.threadId),
    messageId: ChatMessageId(r.messageId),
    modelId: r.modelId,
    mode: r.mode,
    content: r.content,
    question: r.question,
    contextRefs: r.contextRefs as readonly ContextRef[],
    createdAt: IsoTimestamp(r.createdAt),
    ...(r.userNote !== undefined && { userNote: r.userNote }),
  };
}

export function createSavedAnswersRepository(db: BookwormDB): SavedAnswersRepository {
  return {
    async upsert(answer) {
      await db.put(SAVED_ANSWERS_STORE, answer);
    },
    async getById(id) {
      const found = await db.get(SAVED_ANSWERS_STORE, id);
      if (!found) return null;
      return normalizeSavedAnswer(found);
    },
    async getByMessage(messageId) {
      const found = await db.getFromIndex(SAVED_ANSWERS_STORE, 'by-message', messageId);
      if (!found) return null;
      return normalizeSavedAnswer(found);
    },
    async listByBook(bookId) {
      const tx = db.transaction(SAVED_ANSWERS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      const normalized = records
        .map(normalizeSavedAnswer)
        .filter((a): a is SavedAnswer => a !== null);
      normalized.sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
      return normalized;
    },
    async delete(id) {
      await db.delete(SAVED_ANSWERS_STORE, id);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(SAVED_ANSWERS_STORE, 'readwrite');
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
