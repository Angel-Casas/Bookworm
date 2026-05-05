import { describe, it, expect } from 'vitest';
import {
  HISTORY_SOFT_CAP,
  assembleOpenChatPrompt,
  buildOpenModeSystemPrompt,
} from './promptAssembly';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';

function msg(role: 'user' | 'assistant', content: string, idx: number): ChatMessage {
  return {
    id: ChatMessageId(`m-${String(idx)}`),
    threadId: ChatThreadId('t-1'),
    role,
    content,
    contextRefs: [],
    createdAt: IsoTimestamp(`2026-05-05T00:00:${String(idx).padStart(2, '0')}.000Z`),
  };
}

describe('buildOpenModeSystemPrompt', () => {
  it('includes the book title', () => {
    const out = buildOpenModeSystemPrompt({ title: 'Moby-Dick' });
    expect(out).toContain('Moby-Dick');
  });
  it('includes the author when present', () => {
    const out = buildOpenModeSystemPrompt({ title: 'Moby-Dick', author: 'Herman Melville' });
    expect(out).toContain('Herman Melville');
  });
  it('omits "by …" phrasing when author is absent', () => {
    const out = buildOpenModeSystemPrompt({ title: 'Anonymous Tract' });
    expect(out).not.toMatch(/by undefined/);
  });
  it('mentions a no-excerpts disclaimer', () => {
    const out = buildOpenModeSystemPrompt({ title: 'X' });
    expect(out.toLowerCase()).toMatch(/no excerpts|no passages/);
  });
  it('tells the model not to pretend to have read the book', () => {
    const out = buildOpenModeSystemPrompt({ title: 'X' });
    expect(out.toLowerCase()).toMatch(/do not pretend/);
  });
});

describe('assembleOpenChatPrompt', () => {
  it('produces system + history + new user message in order', () => {
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history: [msg('user', 'first', 1), msg('assistant', 'reply', 2)],
      newUserText: 'second',
    });
    expect(out.messages).toHaveLength(4);
    expect(out.messages[0]?.role).toBe('system');
    expect(out.messages[1]).toEqual({ role: 'user', content: 'first' });
    expect(out.messages[2]).toEqual({ role: 'assistant', content: 'reply' });
    expect(out.messages[3]).toEqual({ role: 'user', content: 'second' });
    expect(out.historyDropped).toBe(0);
  });

  it('drops oldest pairs when history exceeds soft cap', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < HISTORY_SOFT_CAP * 2 + 4; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${String(i)}`, i));
    }
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history,
      newUserText: 'now',
    });
    expect(out.historyDropped).toBe(4);
    expect(out.messages).toHaveLength(1 + HISTORY_SOFT_CAP * 2 + 1);
  });

  it('keeps full history when under cap', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 4; i++)
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${String(i)}`, i));
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history,
      newUserText: 'now',
    });
    expect(out.historyDropped).toBe(0);
    expect(out.messages).toHaveLength(1 + 4 + 1);
  });

  it('skips system messages embedded in history', () => {
    const sys: ChatMessage = { ...msg('user', 'should-skip', 0), role: 'system' };
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history: [sys, msg('user', 'kept', 1)],
      newUserText: 'now',
    });
    // system + kept-user + tail-user
    expect(out.messages).toHaveLength(3);
    expect(out.messages[1]?.content).toBe('kept');
  });
});
