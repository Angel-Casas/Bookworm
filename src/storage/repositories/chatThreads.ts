import { BookId, ChatThreadId, IsoTimestamp } from '@/domain';
import type { AnswerStyle, ChatThread } from '@/domain';
import type { BookwormDB } from '../db/open';
import { CHAT_THREADS_STORE } from '../db/schema';

export type ChatThreadsRepository = {
  upsert(thread: ChatThread): Promise<void>;
  getById(id: ChatThreadId): Promise<ChatThread | null>;
  listByBook(bookId: BookId): Promise<readonly ChatThread[]>;
  delete(id: ChatThreadId): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
};

const ANSWER_STYLES: readonly AnswerStyle[] = ['strict-grounded', 'grounded-plus', 'open'];

function normalizeChatThread(record: unknown): ChatThread | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<ChatThread>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  if (typeof r.title !== 'string') return null;
  if (typeof r.modelId !== 'string' || r.modelId === '') return null;
  if (typeof r.answerStyle !== 'string' || !ANSWER_STYLES.includes(r.answerStyle)) {
    return null;
  }
  if (typeof r.createdAt !== 'string') return null;
  if (typeof r.updatedAt !== 'string') return null;
  return {
    id: ChatThreadId(r.id),
    bookId: BookId(r.bookId),
    title: r.title,
    modelId: r.modelId,
    answerStyle: r.answerStyle,
    createdAt: IsoTimestamp(r.createdAt),
    updatedAt: IsoTimestamp(r.updatedAt),
  };
}

export function createChatThreadsRepository(db: BookwormDB): ChatThreadsRepository {
  return {
    async upsert(thread) {
      await db.put(CHAT_THREADS_STORE, thread);
    },
    async getById(id) {
      const found = await db.get(CHAT_THREADS_STORE, id);
      if (!found) return null;
      return normalizeChatThread(found);
    },
    async listByBook(bookId) {
      const tx = db.transaction(CHAT_THREADS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      const normalized = records
        .map(normalizeChatThread)
        .filter((t): t is ChatThread => t !== null);
      normalized.sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
      );
      return normalized;
    },
    async delete(id) {
      await db.delete(CHAT_THREADS_STORE, id);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(CHAT_THREADS_STORE, 'readwrite');
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
