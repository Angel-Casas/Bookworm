import { describe, it, expect } from 'vitest';
import {
  HISTORY_SOFT_CAP,
  HISTORY_SOFT_CAP_OPEN,
  HISTORY_SOFT_CAP_PASSAGE,
  assembleOpenChatPrompt,
  assemblePassageChatPrompt,
  buildOpenModeSystemPrompt,
} from './promptAssembly';
import type { ChatMessage, ChatMode } from '@/domain';
import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';

function msg(
  role: 'user' | 'assistant',
  content: string,
  idx: number,
  mode: ChatMode = 'open',
): ChatMessage {
  return {
    id: ChatMessageId(`m-${String(idx)}`),
    threadId: ChatThreadId('t-1'),
    role,
    content,
    mode,
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

  it('drops to HISTORY_SOFT_CAP_PASSAGE when any history message is passage-mode', () => {
    // 35 pairs (70 msgs) exceeds the passage cap (30) but not the open cap (40).
    const history: ChatMessage[] = [];
    for (let i = 0; i < 35 * 2; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${String(i)}`, i));
    }
    // Mark one mid-history message as passage-mode → trigger reduced cap.
    history[10] = { ...history[10]!, mode: 'passage' };
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history,
      newUserText: 'now',
    });
    // 70 msgs - 30 pairs * 2 = 70 - 60 = 10 dropped.
    expect(out.historyDropped).toBe(70 - HISTORY_SOFT_CAP_PASSAGE * 2);
  });

  it('stays at HISTORY_SOFT_CAP_OPEN when no message is passage-mode', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 45 * 2; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${String(i)}`, i));
    }
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history,
      newUserText: 'now',
    });
    // 90 msgs - 40 pairs * 2 = 10 dropped.
    expect(out.historyDropped).toBe(90 - HISTORY_SOFT_CAP_OPEN * 2);
  });

  it('exposes HISTORY_SOFT_CAP as a backward alias for HISTORY_SOFT_CAP_OPEN', () => {
    expect(HISTORY_SOFT_CAP).toBe(HISTORY_SOFT_CAP_OPEN);
  });
});

describe('assemblePassageChatPrompt', () => {
  const book = { title: 'Pride and Prejudice', author: 'Jane Austen', format: 'epub' as const };
  const passage = {
    text: 'She scarcely heard the rest, she was so taken aback.',
    windowBefore: 'the conversation drifted, and as Mr. Darcy spoke,',
    windowAfter: 'all of this in the midst of the parlour quiet hum.',
    sectionTitle: 'Chapter 4',
  };

  it('emits exactly one combined system message containing both the open prompt and the passage addendum', () => {
    const out = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'What is happening here?',
      passage,
    });
    const systemMsgs = out.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0]!.content).toContain('Pride and Prejudice');
    expect(systemMsgs[0]!.content.toLowerCase()).toContain('passage');
    expect(systemMsgs[0]!.content.toLowerCase()).toContain('attached');
  });

  it('prepends the passage block to the new user message with bold delimiters and ellipses on windows', () => {
    const out = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'Explain.',
      passage,
    });
    const last = out.messages[out.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toContain(`**${passage.text}**`);
    expect(last.content).toContain(`…${passage.windowBefore}`);
    expect(last.content).toContain(`${passage.windowAfter}…`);
    expect(last.content).toContain(passage.sectionTitle);
    // The user's question follows the passage block.
    expect(last.content.endsWith('Explain.')).toBe(true);
  });

  it('omits ellipsis windows and section line when those fields are absent', () => {
    const out = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'Q',
      passage: { text: 'just selection text' },
    });
    const last = out.messages[out.messages.length - 1]!;
    expect(last.content).toContain('**just selection text**');
    expect(last.content).not.toContain('…');
    expect(last.content).not.toContain(' — ');
  });

  it('preserves user/assistant history between system and the new user message', () => {
    const history = [
      msg('user', 'first question', 1),
      msg('assistant', 'first answer', 2),
    ];
    const out = assemblePassageChatPrompt({
      book,
      history,
      newUserText: 'follow-up',
      passage,
    });
    expect(out.messages).toHaveLength(4); // system + 2 history + 1 new user
    expect(out.messages[1]).toEqual({ role: 'user', content: 'first question' });
    expect(out.messages[2]).toEqual({ role: 'assistant', content: 'first answer' });
  });

  it('uses HISTORY_SOFT_CAP_PASSAGE for its own history truncation', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 35 * 2; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${String(i)}`, i));
    }
    const out = assemblePassageChatPrompt({
      book,
      history,
      newUserText: 'now',
      passage,
    });
    expect(out.historyDropped).toBe(70 - HISTORY_SOFT_CAP_PASSAGE * 2);
  });

  it('caps selection text at 4000 chars in the bolded block and notes truncation', () => {
    const longText = 'x'.repeat(5000);
    const out = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'Q',
      passage: { text: longText },
    });
    const last = out.messages[out.messages.length - 1]!;
    const match = /\*\*(x+)\*\*/.exec(last.content);
    expect(match).not.toBeNull();
    expect(match![1]!.length).toBe(4000);
    expect(last.content).toContain('truncated for AI');
  });
});
