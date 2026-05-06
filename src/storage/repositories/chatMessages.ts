import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';
import type { ChatMessage, ChatMode, ChatRole } from '@/domain';
import type { BookwormDB } from '../db/open';
import { CHAT_MESSAGES_STORE } from '../db/schema';
import { isValidContextRef } from './contextRefValidation';

export type ChatMessagesRepository = {
  upsert(message: ChatMessage): Promise<void>;
  getById(id: ChatMessageId): Promise<ChatMessage | null>;
  listByThread(threadId: ChatThreadId): Promise<readonly ChatMessage[]>;
  delete(id: ChatMessageId): Promise<void>;
  deleteByThread(threadId: ChatThreadId): Promise<void>;
};

const ROLES: readonly ChatRole[] = ['system', 'user', 'assistant'];
const MODES: readonly ChatMode[] = [
  'open',
  'passage',
  'chapter',
  'multi-excerpt',
  'retrieval',
  'full-book',
];
const ERROR_VALUES = new Set(['interrupted', 'failed']);

function normalizeChatMessage(record: unknown): ChatMessage | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<ChatMessage> & Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.threadId !== 'string' || r.threadId === '') return null;
  if (typeof r.role !== 'string' || !ROLES.includes(r.role)) return null;
  if (typeof r.content !== 'string') return null;
  if (!Array.isArray(r.contextRefs)) return null;
  // Per-element validation: drop malformed passage refs but keep the rest.
  // Phase 4.4 added a required `anchor` to the passage variant; older bad
  // records (none currently exist — pre-flight grep clean) would just lose
  // the malformed ref while the message itself survives.
  const contextRefs = r.contextRefs.filter(isValidContextRef);
  if (typeof r.createdAt !== 'string') return null;
  // mode is optional but if present must be a known value
  if (r.mode !== undefined && (typeof r.mode !== 'string' || !MODES.includes(r.mode))) {
    return null;
  }
  // streaming/truncated optional booleans
  if (r.streaming !== undefined && typeof r.streaming !== 'boolean') return null;
  if (r.truncated !== undefined && typeof r.truncated !== 'boolean') return null;
  if (r.error !== undefined && (typeof r.error !== 'string' || !ERROR_VALUES.has(r.error))) {
    return null;
  }
  const normalized: ChatMessage = {
    id: ChatMessageId(r.id),
    threadId: ChatThreadId(r.threadId),
    role: r.role,
    content: r.content,
    contextRefs,
    createdAt: IsoTimestamp(r.createdAt),
    ...(r.mode !== undefined && { mode: r.mode }),
    ...(r.usage !== undefined && { usage: r.usage }),
    ...(r.streaming !== undefined && { streaming: r.streaming }),
    ...(r.truncated !== undefined && { truncated: r.truncated }),
    ...(r.error !== undefined && { error: r.error }),
  };
  return normalized;
}

export function createChatMessagesRepository(db: BookwormDB): ChatMessagesRepository {
  return {
    async upsert(message) {
      await db.put(CHAT_MESSAGES_STORE, message);
    },
    async getById(id) {
      const found = await db.get(CHAT_MESSAGES_STORE, id);
      if (!found) return null;
      return normalizeChatMessage(found);
    },
    async listByThread(threadId) {
      const tx = db.transaction(CHAT_MESSAGES_STORE, 'readonly');
      const index = tx.store.index('by-thread');
      const records = await index.getAll(threadId);
      const normalized = records
        .map(normalizeChatMessage)
        .filter((m): m is ChatMessage => m !== null);
      normalized.sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
      );
      return normalized;
    },
    async delete(id) {
      await db.delete(CHAT_MESSAGES_STORE, id);
    },
    async deleteByThread(threadId) {
      const tx = db.transaction(CHAT_MESSAGES_STORE, 'readwrite');
      const index = tx.store.index('by-thread');
      let cursor = await index.openKeyCursor(threadId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
