import { assign, fromCallback, setup } from 'xstate';
import type { ChatMessageId, ChatThreadId, TokenUsage } from '@/domain';
import {
  ChatCompletionError,
  type ChatCompletionFailure,
  type ChatCompletionMessage,
  type StreamEvent,
} from './nanogptChat';

export type ChatRequestInput = {
  readonly threadId: ChatThreadId;
  readonly pendingUserMessageId: ChatMessageId;
  readonly pendingAssistantMessageId: ChatMessageId;
  readonly modelId: string;
  readonly assembled: { readonly messages: readonly ChatCompletionMessage[] };
};

export type ChatRequestContext = ChatRequestInput & {
  partial: string;
  usage?: TokenUsage;
  failure?: ChatCompletionFailure;
};

export type ChatRequestEvent =
  | { type: 'DELTA'; text: string }
  | { type: 'USAGE'; usage: TokenUsage }
  | { type: 'STREAM_DONE' }
  | { type: 'STREAM_ERROR'; failure: ChatCompletionFailure }
  | { type: 'CANCEL' };

export type FinalizeFields = {
  readonly content: string;
  readonly streaming: false;
  readonly usage?: TokenUsage;
  readonly truncated?: true;
  readonly error?: 'failed' | 'interrupted';
};

export type MachineDeps = {
  readonly streamFactory: (
    assembled: { readonly messages: readonly ChatCompletionMessage[] },
    modelId: string,
    signal: AbortSignal,
  ) => AsyncGenerator<StreamEvent>;
  readonly onDelta: (
    id: ChatMessageId,
    fields: { readonly content: string; readonly streaming: true },
  ) => Promise<void>;
  readonly finalize: (id: ChatMessageId, fields: FinalizeFields) => Promise<void>;
};

export function makeChatRequestMachine(deps: MachineDeps) {
  const streamActor = fromCallback<{ type: 'NOOP' }, ChatRequestContext>(
    ({ sendBack, input }) => {
      const ctrl = new AbortController();
      let cancelled = false;
      void (async () => {
        try {
          const gen = deps.streamFactory(input.assembled, input.modelId, ctrl.signal);
          for await (const evt of gen) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
            if (cancelled) return;
            if (evt.kind === 'delta') {
              sendBack({ type: 'DELTA', text: evt.text });
            } else if (evt.kind === 'usage') {
              sendBack({
                type: 'USAGE',
                usage: {
                  promptTokens: evt.prompt,
                  completionTokens: evt.completion,
                  ...(evt.cached !== undefined ? { cachedTokens: evt.cached } : {}),
                },
              });
            } else {
              sendBack({ type: 'STREAM_DONE' });
            }
          }
        } catch (e) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup closure
          if (cancelled) return;
          const failure: ChatCompletionFailure =
            e instanceof ChatCompletionError
              ? e.failure
              : { reason: 'malformed-stream' };
          sendBack({ type: 'STREAM_ERROR', failure });
        }
      })();
      return () => {
        cancelled = true;
        ctrl.abort();
      };
    },
  );

  return setup({
    types: {
      context: {} as ChatRequestContext,
      events: {} as ChatRequestEvent,
      input: {} as ChatRequestInput,
    },
    actors: { streamActor },
    actions: {
      appendDelta: assign({
        partial: ({ context, event }) =>
          event.type === 'DELTA' ? context.partial + event.text : context.partial,
      }),
      assignUsage: assign({
        usage: ({ event, context }) =>
          event.type === 'USAGE' ? event.usage : context.usage,
      }),
      assignFailure: assign({
        failure: ({ event, context }) =>
          event.type === 'STREAM_ERROR' ? event.failure : context.failure,
      }),
      patchPartialAsync: ({ context, event }) => {
        if (event.type !== 'DELTA') return;
        const next = context.partial + event.text;
        void deps.onDelta(context.pendingAssistantMessageId, {
          content: next,
          streaming: true,
        });
      },
      finalizeDone: ({ context }) => {
        void deps.finalize(context.pendingAssistantMessageId, {
          content: context.partial,
          streaming: false,
          ...(context.usage !== undefined ? { usage: context.usage } : {}),
        });
      },
      finalizeAborted: ({ context }) => {
        void deps.finalize(context.pendingAssistantMessageId, {
          content: context.partial,
          streaming: false,
          truncated: true,
        });
      },
      finalizeFailed: ({ context }) => {
        void deps.finalize(context.pendingAssistantMessageId, {
          content: context.partial,
          streaming: false,
          error: 'failed',
        });
      },
    },
  }).createMachine({
    id: 'chatRequest',
    initial: 'streaming',
    context: ({ input }) => ({ ...input, partial: '' }),
    states: {
      streaming: {
        invoke: { src: 'streamActor', input: ({ context }) => context },
        on: {
          DELTA: { actions: ['appendDelta', 'patchPartialAsync'] },
          USAGE: { actions: 'assignUsage' },
          STREAM_DONE: { target: 'done' },
          STREAM_ERROR: { target: 'failed', actions: 'assignFailure' },
          CANCEL: { target: 'aborted' },
        },
      },
      done: {
        type: 'final',
        entry: 'finalizeDone',
        output: ({ context }) => ({
          partial: context.partial,
          usage: context.usage,
        }),
      },
      aborted: {
        type: 'final',
        entry: 'finalizeAborted',
        output: ({ context }) => ({
          partial: context.partial,
          aborted: true as const,
        }),
      },
      failed: {
        type: 'final',
        entry: 'finalizeFailed',
        output: ({ context }) => ({
          partial: context.partial,
          failure: context.failure,
        }),
      },
    },
  });
}
