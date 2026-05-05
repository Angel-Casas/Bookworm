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
