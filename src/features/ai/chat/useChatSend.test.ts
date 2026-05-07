import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatSend } from './useChatSend';
import type { ChatCompletionRequest, StreamEvent } from './nanogptChat';
import { ChatThreadId } from '@/domain';

async function* mkStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  await Promise.resolve();
  for (const e of events) yield e;
}

describe('useChatSend', () => {
  it('sends, accumulates partial, finalizes', async () => {
    const append = vi.fn(() => Promise.resolve(undefined));
    const patch = vi.fn(() => Promise.resolve(undefined));
    const finalize = vi.fn(() => Promise.resolve(undefined));
    const streamFactory = (_req: ChatCompletionRequest) =>
      mkStream([
        { kind: 'delta', text: 'hi ' },
        { kind: 'delta', text: 'there' },
        { kind: 'done' },
      ]);
    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t-1'),
        modelId: 'gpt-x',
        getApiKey: () => 'sk',
        book: { title: 'X', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
        streamFactory,
      }),
    );
    act(() => {
      result.current.send('hello');
    });
    await waitFor(() => {
      expect(finalize).toHaveBeenCalled();
    });
    // user + assistant placeholder
    expect(append).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('idle');
  });

  it('threadId override pins persisted messages to the override id, not args.threadId', async () => {
    // Regression: ChatPanel.handleSendNew creates a real thread via
    // persistDraft() and immediately calls send.send() in the same callback.
    // Without an override, send reads args.threadId (still the draft
    // sentinel) because React hasn't re-rendered yet. Result: every first
    // message of a new thread persists under '__draft__' and orphans.
    const append = vi.fn(() => Promise.resolve(undefined));
    const patch = vi.fn(() => Promise.resolve(undefined));
    const finalize = vi.fn(() => Promise.resolve(undefined));
    const streamFactory = (_req: ChatCompletionRequest) =>
      mkStream([{ kind: 'delta', text: 'ok' }, { kind: 'done' }]);
    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('__draft__'),
        modelId: 'gpt-x',
        getApiKey: () => 'sk',
        book: { title: 'X', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
        streamFactory,
      }),
    );
    const realId = ChatThreadId('t-real-1');
    act(() => {
      result.current.send('hello', realId);
    });
    await waitFor(() => {
      expect(finalize).toHaveBeenCalled();
    });
    // Both the user message append and the assistant placeholder append
    // must use the override id. Neither should leak under '__draft__'.
    for (const call of append.mock.calls) {
      const arg = (call as unknown as unknown[])[0] as { threadId: string };
      expect(arg.threadId).toBe('t-real-1');
      expect(arg.threadId).not.toBe('__draft__');
    }
    // finalize is called with (messageId, patch); messageId encodes nothing
    // about the thread, but the placeholder append above already pinned it
    // to the override, so the finalize patch lands on the right thread.
  });

  it('without override, falls back to args.threadId (existing-thread sends unchanged)', async () => {
    const append = vi.fn(() => Promise.resolve(undefined));
    const patch = vi.fn(() => Promise.resolve(undefined));
    const finalize = vi.fn(() => Promise.resolve(undefined));
    const streamFactory = (_req: ChatCompletionRequest) =>
      mkStream([{ kind: 'done' }]);
    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t-2'),
        modelId: 'gpt-x',
        getApiKey: () => 'sk',
        book: { title: 'X', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
        streamFactory,
      }),
    );
    act(() => {
      result.current.send('hello');
    });
    await waitFor(() => {
      expect(finalize).toHaveBeenCalled();
    });
    for (const call of append.mock.calls) {
      const arg = (call as unknown as unknown[])[0] as { threadId: string };
      expect(arg.threadId).toBe('t-2');
    }
  });

  it('cancel mid-stream transitions to aborted', async () => {
    const append = vi.fn(() => Promise.resolve(undefined));
    const patch = vi.fn(() => Promise.resolve(undefined));
    const finalize = vi.fn(() => Promise.resolve(undefined));
    let resolveSecond: () => void = () => undefined;
    const second = new Promise<void>((r) => {
      resolveSecond = r;
    });
    async function* slow(): AsyncGenerator<StreamEvent> {
      yield { kind: 'delta', text: 'partial' };
      await second;
      yield { kind: 'done' };
    }
    const streamFactory = (_req: ChatCompletionRequest) => slow();
    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t-1'),
        modelId: 'gpt-x',
        getApiKey: () => 'sk',
        book: { title: 'X', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
        streamFactory,
      }),
    );
    act(() => {
      result.current.send('hello');
    });
    await waitFor(() => {
      expect(result.current.state).toBe('streaming');
    });
    act(() => {
      result.current.cancel();
    });
    resolveSecond();
    await waitFor(() => {
      expect(result.current.state).toBe('aborted');
    });
    expect(finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ truncated: true }),
    );
  });

  describe('with attachedPassage', () => {
    const passage = {
      anchor: { kind: 'epub-cfi' as const, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
      text: 'she scarcely heard the rest',
      windowBefore: 'before context',
      windowAfter: 'after context',
      sectionTitle: 'Chapter 4',
    };

    it('sets mode=passage on both user and assistant messages of the turn', async () => {
      const append = vi.fn(() => Promise.resolve(undefined));
      const patch = vi.fn(() => Promise.resolve(undefined));
      const finalize = vi.fn(() => Promise.resolve(undefined));
      const streamFactory = (_req: ChatCompletionRequest) =>
        mkStream([{ kind: 'delta', text: 'ans' }, { kind: 'done' }]);
      const { result } = renderHook(() =>
        useChatSend({
          threadId: ChatThreadId('t-1'),
          modelId: 'gpt-x',
          getApiKey: () => 'sk',
          book: { title: 'X', format: 'epub' },
          history: [],
          append,
          patch,
          finalize,
          streamFactory,
          attachedPassage: passage,
        }),
      );
      act(() => {
        result.current.send('q');
      });
      await waitFor(() => {
        expect(finalize).toHaveBeenCalled();
      });
      expect(append).toHaveBeenCalledTimes(2);
      expect(append).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ role: 'user', mode: 'passage' }),
      );
      expect(append).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ role: 'assistant', mode: 'passage' }),
      );
    });

    // The asymmetry is load-bearing — see spec §4.2. A future "let's normalize
    // them" refactor would silently re-introduce ~5KB of dead duplicate per
    // question. This assertion locks the contract.
    it('writes passage contextRefs ONLY on the assistant message; user message stays empty', async () => {
      const append = vi.fn(() => Promise.resolve(undefined));
      const patch = vi.fn(() => Promise.resolve(undefined));
      const finalize = vi.fn(() => Promise.resolve(undefined));
      const streamFactory = (_req: ChatCompletionRequest) =>
        mkStream([{ kind: 'delta', text: 'ans' }, { kind: 'done' }]);
      const { result } = renderHook(() =>
        useChatSend({
          threadId: ChatThreadId('t-1'),
          modelId: 'gpt-x',
          getApiKey: () => 'sk',
          book: { title: 'X', format: 'epub' },
          history: [],
          append,
          patch,
          finalize,
          streamFactory,
          attachedPassage: passage,
        }),
      );
      act(() => {
        result.current.send('q');
      });
      await waitFor(() => {
        expect(finalize).toHaveBeenCalled();
      });

      const calls = append.mock.calls as readonly (readonly unknown[])[];
      const userArg = calls[0]?.[0] as
        | { contextRefs: readonly unknown[] }
        | undefined;
      const assistantArg = calls[1]?.[0] as
        | { contextRefs: readonly { kind: string; anchor: unknown }[] }
        | undefined;
      expect(userArg?.contextRefs).toEqual([]);
      expect(assistantArg?.contextRefs).toHaveLength(1);
      expect(assistantArg?.contextRefs[0]?.kind).toBe('passage');
      expect(assistantArg?.contextRefs[0]?.anchor).toEqual(passage.anchor);
    });

    it('uses assemblePassageChatPrompt — the prompt sent contains the bolded selection', async () => {
      const append = vi.fn(() => Promise.resolve(undefined));
      const patch = vi.fn(() => Promise.resolve(undefined));
      const finalize = vi.fn(() => Promise.resolve(undefined));
      const sentMessages: { role: string; content: string }[] = [];
      const streamFactory = (req: ChatCompletionRequest) => {
        sentMessages.push(...req.messages);
        return mkStream([{ kind: 'delta', text: 'ans' }, { kind: 'done' }]);
      };
      const { result } = renderHook(() =>
        useChatSend({
          threadId: ChatThreadId('t-1'),
          modelId: 'gpt-x',
          getApiKey: () => 'sk',
          book: { title: 'X', format: 'epub' },
          history: [],
          append,
          patch,
          finalize,
          streamFactory,
          attachedPassage: passage,
        }),
      );
      act(() => {
        result.current.send('explain');
      });
      await waitFor(() => {
        expect(finalize).toHaveBeenCalled();
      });

      const lastUser = sentMessages[sentMessages.length - 1]!;
      expect(lastUser.role).toBe('user');
      expect(lastUser.content).toContain(`**${passage.text}**`);
      expect(lastUser.content).toContain(passage.sectionTitle);
      expect(lastUser.content.endsWith('explain')).toBe(true);
    });

    it('attachedPassage=null keeps the Phase 4.3 open-mode behavior (mode=open, contextRefs=[])', async () => {
      const append = vi.fn(() => Promise.resolve(undefined));
      const patch = vi.fn(() => Promise.resolve(undefined));
      const finalize = vi.fn(() => Promise.resolve(undefined));
      const streamFactory = (_req: ChatCompletionRequest) =>
        mkStream([{ kind: 'delta', text: 'ans' }, { kind: 'done' }]);
      const { result } = renderHook(() =>
        useChatSend({
          threadId: ChatThreadId('t-1'),
          modelId: 'gpt-x',
          getApiKey: () => 'sk',
          book: { title: 'X', format: 'epub' },
          history: [],
          append,
          patch,
          finalize,
          streamFactory,
          attachedPassage: null,
        }),
      );
      act(() => {
        result.current.send('q');
      });
      await waitFor(() => {
        expect(finalize).toHaveBeenCalled();
      });

      expect(append).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ role: 'user', mode: 'open', contextRefs: [] }),
      );
      expect(append).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ role: 'assistant', mode: 'open', contextRefs: [] }),
      );
    });
  });

  it('without an api key, surfaces invalid-key failure without sending', () => {
    const append = vi.fn(() => Promise.resolve(undefined));
    const patch = vi.fn(() => Promise.resolve(undefined));
    const finalize = vi.fn(() => Promise.resolve(undefined));
    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t-1'),
        modelId: 'gpt-x',
        getApiKey: () => null,
        book: { title: 'X', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
      }),
    );
    act(() => {
      result.current.send('hello');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.failure?.reason).toBe('invalid-key');
    expect(append).not.toHaveBeenCalled();
  });
});
