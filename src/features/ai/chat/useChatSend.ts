import { useCallback, useEffect, useRef, useState } from 'react';
import { createActor, type Actor } from 'xstate';
import {
  ChatMessageId,
  IsoTimestamp,
  type BookFormat,
  type ChatMessage,
  type ChatThreadId,
} from '@/domain';
import { assembleOpenChatPrompt } from './promptAssembly';
import { streamChatCompletion, type ChatCompletionFailure } from './nanogptChat';
import { makeChatRequestMachine } from './chatRequestMachine';

export type SendState = 'idle' | 'streaming' | 'error' | 'aborted';

type Args = {
  readonly threadId: ChatThreadId;
  readonly modelId: string;
  readonly getApiKey: () => string | null;
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly history: readonly ChatMessage[];
  readonly append: (msg: ChatMessage) => Promise<void>;
  readonly patch: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
  readonly finalize: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
  readonly streamFactory?: typeof streamChatCompletion;
};

export type UseChatSendHandle = {
  readonly state: SendState;
  readonly partial: string;
  readonly failure: ChatCompletionFailure | null;
  readonly send: (userText: string) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
};

function nextId(prefix: string): ChatMessageId {
  return ChatMessageId(
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

export function useChatSend(args: Args): UseChatSendHandle {
  const [state, setState] = useState<SendState>('idle');
  const [partial, setPartial] = useState<string>('');
  const [failure, setFailure] = useState<ChatCompletionFailure | null>(null);
  const actorRef = useRef<Actor<ReturnType<typeof makeChatRequestMachine>> | null>(null);
  const lastInputRef = useRef<string | null>(null);
  const argsRef = useRef(args);

  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  useEffect(
    () => () => {
      actorRef.current?.stop();
      actorRef.current = null;
    },
    [],
  );

  const send = useCallback((userText: string): void => {
    const a = argsRef.current;
    const apiKey = a.getApiKey();
    if (apiKey === null) {
      setFailure({ reason: 'invalid-key', status: 401 });
      setState('error');
      return;
    }
    lastInputRef.current = userText;
    const userMsgId = nextId('u');
    const assistantMsgId = nextId('a');
    const now = IsoTimestamp(new Date().toISOString());
    const nowPlus = IsoTimestamp(new Date(Date.now() + 1).toISOString());

    void a.append({
      id: userMsgId,
      threadId: a.threadId,
      role: 'user',
      content: userText,
      mode: 'open',
      contextRefs: [],
      createdAt: now,
    });
    void a.append({
      id: assistantMsgId,
      threadId: a.threadId,
      role: 'assistant',
      content: '',
      mode: 'open',
      contextRefs: [],
      streaming: true,
      createdAt: nowPlus,
    });

    const assembled = assembleOpenChatPrompt({
      book: a.book,
      history: a.history,
      newUserText: userText,
    });

    const factory = a.streamFactory ?? streamChatCompletion;

    const machine = makeChatRequestMachine({
      streamFactory: (assembled2, modelId, signal) =>
        factory({
          apiKey,
          modelId,
          messages: assembled2.messages,
          signal,
        }),
      onDelta: async (id, fields) => {
        setPartial(fields.content);
        await a.patch(id, fields);
      },
      finalize: async (id, fields) => {
        await a.finalize(id, fields);
      },
    });

    actorRef.current?.stop();
    const actor = createActor(machine, {
      input: {
        threadId: a.threadId,
        pendingUserMessageId: userMsgId,
        pendingAssistantMessageId: assistantMsgId,
        modelId: a.modelId,
        assembled,
      },
    });

    actor.subscribe((snap) => {
      if (snap.status === 'done') {
        if (snap.value === 'failed') {
          const ctxFailure = (snap.context as { failure?: ChatCompletionFailure }).failure;
          if (ctxFailure) setFailure(ctxFailure);
          setState('error');
        } else if (snap.value === 'aborted') {
          setState('aborted');
        } else {
          setState('idle');
        }
      }
    });

    actorRef.current = actor;
    setState('streaming');
    setPartial('');
    setFailure(null);
    actor.start();
  }, []);

  const cancel = useCallback((): void => {
    actorRef.current?.send({ type: 'CANCEL' });
  }, []);

  const retry = useCallback((): void => {
    if (lastInputRef.current !== null) send(lastInputRef.current);
  }, [send]);

  return { state, partial, failure, send, cancel, retry };
}
