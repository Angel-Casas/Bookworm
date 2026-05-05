import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  createSavedAnswersRepository,
  openBookwormDB,
  type BookwormDB,
} from '@/storage';
import { useSavedAnswers } from './useSavedAnswers';
import {
  BookId,
  ChatMessageId,
  ChatThreadId,
  IsoTimestamp,
  SavedAnswerId,
} from '@/domain';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-useSavedAnswers-${crypto.randomUUID()}`);
});

afterEach(() => {
  db.close();
});

describe('useSavedAnswers', () => {
  it('loads existing saved answers newest-first', async () => {
    const repo = createSavedAnswersRepository(db);
    await repo.upsert({
      id: SavedAnswerId('s-old'),
      bookId: BookId('book-1'),
      threadId: ChatThreadId('t'),
      messageId: ChatMessageId('m-1'),
      modelId: 'gpt-x',
      mode: 'open',
      content: 'old',
      question: 'q1',
      contextRefs: [],
      createdAt: IsoTimestamp('2026-05-04T00:00:00.000Z'),
    });
    await repo.upsert({
      id: SavedAnswerId('s-new'),
      bookId: BookId('book-1'),
      threadId: ChatThreadId('t'),
      messageId: ChatMessageId('m-2'),
      modelId: 'gpt-x',
      mode: 'open',
      content: 'new',
      question: 'q2',
      contextRefs: [],
      createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    });
    const { result } = renderHook(() =>
      useSavedAnswers({ bookId: BookId('book-1'), savedAnswersRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(2);
    });
    expect(result.current.list[0]?.id).toBe(SavedAnswerId('s-new'));
  });

  it('add appends newest-first and persists', async () => {
    const repo = createSavedAnswersRepository(db);
    const { result } = renderHook(() =>
      useSavedAnswers({ bookId: BookId('book-1'), savedAnswersRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(0);
    });
    await act(async () => {
      await result.current.add({
        threadId: ChatThreadId('t'),
        messageId: ChatMessageId('m'),
        modelId: 'gpt-x',
        mode: 'open',
        content: 'a',
        question: 'q',
        contextRefs: [],
      });
    });
    expect(result.current.list).toHaveLength(1);
    expect((await repo.listByBook(BookId('book-1'))).length).toBe(1);
  });

  it('remove deletes from list and storage', async () => {
    const repo = createSavedAnswersRepository(db);
    const { result } = renderHook(() =>
      useSavedAnswers({ bookId: BookId('book-1'), savedAnswersRepo: repo }),
    );
    let savedId: SavedAnswerId | undefined;
    await act(async () => {
      const saved = await result.current.add({
        threadId: ChatThreadId('t'),
        messageId: ChatMessageId('m'),
        modelId: 'gpt-x',
        mode: 'open',
        content: 'a',
        question: 'q',
        contextRefs: [],
      });
      savedId = saved.id;
    });
    if (!savedId) throw new Error('saved id missing');
    await act(async () => {
      await result.current.remove(savedId!);
    });
    expect(result.current.list).toHaveLength(0);
    expect(await repo.getById(savedId)).toBeNull();
  });
});
