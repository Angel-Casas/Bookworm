import { describe, it, expect, vi } from 'vitest';
import { createActor } from 'xstate';
import { makeChatRequestMachine, type FinalizeFields } from './chatRequestMachine';
import type { StreamEvent } from './nanogptChat';
import { ChatCompletionError } from './nanogptChat';
import { ChatMessageId, ChatThreadId } from '@/domain';

async function* mkStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  await Promise.resolve();
  for (const e of events) yield e;
}

function startMachineWith(opts: {
  stream: () => AsyncGenerator<StreamEvent>;
  finalize?: (id: ChatMessageId, fields: FinalizeFields) => Promise<void>;
  onDelta?: (
    id: ChatMessageId,
    fields: { readonly content: string; readonly streaming: true },
  ) => Promise<void>;
}) {
  const finalize =
    opts.finalize ??
    vi.fn(async () => {
      /* no-op */
    });
  const onDelta =
    opts.onDelta ??
    vi.fn(async () => {
      /* no-op */
    });
  const machine = makeChatRequestMachine({
    streamFactory: () => opts.stream(),
    onDelta,
    finalize,
  });
  const actor = createActor(machine, {
    input: {
      threadId: ChatThreadId('t-1'),
      pendingUserMessageId: ChatMessageId('u-1'),
      pendingAssistantMessageId: ChatMessageId('a-1'),
      modelId: 'gpt-x',
      assembled: { messages: [{ role: 'user', content: 'hi' }] },
    },
  });
  actor.start();
  return { actor, finalize, onDelta };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

describe('chatRequestMachine', () => {
  it('reaches done after a clean stream', async () => {
    const { actor, finalize } = startMachineWith({
      stream: () =>
        mkStream([
          { kind: 'delta', text: 'hel' },
          { kind: 'delta', text: 'lo' },
          { kind: 'usage', prompt: 5, completion: 2 },
          { kind: 'done' },
        ]),
    });
    await flushMicrotasks();
    const snap = actor.getSnapshot();
    expect(snap.status).toBe('done');
    expect(snap.value).toBe('done');
    expect(finalize).toHaveBeenCalledWith(
      ChatMessageId('a-1'),
      expect.objectContaining({ content: 'hello', streaming: false }),
    );
  });

  it('captures partial text on cancel and finalizes truncated=true', async () => {
    let resolveSecond: () => void = () => undefined;
    const second = new Promise<void>((r) => {
      resolveSecond = r;
    });
    async function* slow(): AsyncGenerator<StreamEvent> {
      yield { kind: 'delta', text: 'partial' };
      await second;
      yield { kind: 'done' };
    }
    const { actor, finalize } = startMachineWith({ stream: () => slow() });
    await flushMicrotasks();
    actor.send({ type: 'CANCEL' });
    resolveSecond();
    await flushMicrotasks();
    expect(actor.getSnapshot().value).toBe('aborted');
    expect(finalize).toHaveBeenCalledWith(
      ChatMessageId('a-1'),
      expect.objectContaining({ truncated: true }),
    );
  });

  it('routes invalid-key failure to failed state', async () => {
    // eslint-disable-next-line require-yield -- intentional: throws before any yield
    async function* failing(): AsyncGenerator<StreamEvent> {
      await Promise.resolve();
      throw new ChatCompletionError({ reason: 'invalid-key', status: 401 });
    }
    const { actor, finalize } = startMachineWith({ stream: () => failing() });
    await flushMicrotasks();
    expect(actor.getSnapshot().value).toBe('failed');
    expect(finalize).toHaveBeenCalledWith(
      ChatMessageId('a-1'),
      expect.objectContaining({ error: 'failed' }),
    );
  });

  it('records usage on done (passed through finalize)', async () => {
    const finalize = vi.fn(async () => {
      /* no-op */
    });
    startMachineWith({
      stream: () =>
        mkStream([
          { kind: 'delta', text: 'x' },
          { kind: 'usage', prompt: 11, completion: 4 },
          { kind: 'done' },
        ]),
      finalize,
    });
    await flushMicrotasks();
    expect(finalize).toHaveBeenCalled();
    expect(finalize).toHaveBeenLastCalledWith(
      ChatMessageId('a-1'),
      expect.objectContaining({
        content: 'x',
        streaming: false,
        usage: { promptTokens: 11, completionTokens: 4 },
      }),
    );
  });
});
