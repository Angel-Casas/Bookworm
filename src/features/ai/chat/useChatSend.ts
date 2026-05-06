import { useCallback, useEffect, useRef, useState } from 'react';
import { createActor, type Actor } from 'xstate';
import {
  ChatMessageId,
  IsoTimestamp,
  type BookFormat,
  type BookId,
  type ChatMessage,
  type ChatThreadId,
  type ContextRef,
} from '@/domain';
import type { HighlightAnchor } from '@/domain/annotations/types';
import {
  assembleOpenChatPrompt,
  assemblePassageChatPrompt,
  assembleRetrievalChatPrompt,
} from './promptAssembly';
import { streamChatCompletion, type ChatCompletionFailure } from './nanogptChat';
import { makeChatRequestMachine } from './chatRequestMachine';
import {
  runRetrieval,
  type RetrievalDeps,
  type RetrievalResult,
} from '@/features/ai/retrieval/runRetrieval';

export type SendState = 'idle' | 'streaming' | 'error' | 'aborted';

export type AttachedPassage = {
  readonly anchor: HighlightAnchor;
  readonly text: string;
  readonly windowBefore?: string;
  readonly windowAfter?: string;
  readonly sectionTitle?: string;
};

// Phase 5.2 retrieval mode. One-shot per send (chip clears on send); the
// actual retrieved chunks are determined at send-time by runRetrieval.
export type AttachedRetrieval = {
  readonly bookId: BookId;
};

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
  readonly attachedPassage?: AttachedPassage | null;
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly retrievalDeps?: RetrievalDeps;
  readonly retrievalRunner?: (input: {
    bookId: BookId;
    question: string;
    deps: RetrievalDeps;
    signal?: AbortSignal;
  }) => Promise<RetrievalResult>;
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

    const retrieval = a.attachedRetrieval ?? null;
    const passage = a.attachedPassage ?? null;
    const isRetrieval = retrieval !== null;
    const isPassage = !isRetrieval && passage !== null;

    // Retrieval branch — needs an async runRetrieval before assembly.
    if (isRetrieval) {
      void a.append({
        id: userMsgId,
        threadId: a.threadId,
        role: 'user',
        content: userText,
        mode: 'retrieval',
        contextRefs: [],
        createdAt: now,
      });
      void a.append({
        id: assistantMsgId,
        threadId: a.threadId,
        role: 'assistant',
        content: '',
        mode: 'retrieval',
        contextRefs: [],
        streaming: true,
        createdAt: nowPlus,
      });

      void (async () => {
        const runner = a.retrievalRunner ?? runRetrieval;
        if (a.retrievalDeps === undefined) {
          await a.finalize(assistantMsgId, {
            content: 'Retrieval is not configured for this book.',
            streaming: false,
          });
          setState('idle');
          return;
        }
        const result = await runner({
          bookId: retrieval.bookId,
          question: userText,
          deps: a.retrievalDeps,
        });
        if (result.kind === 'no-embeddings') {
          await a.finalize(assistantMsgId, {
            content:
              'This book is still being prepared for AI. Wait for the library card to show ✓ Indexed and try again.',
            streaming: false,
          });
          setState('idle');
          return;
        }
        if (result.kind === 'no-results') {
          await a.finalize(assistantMsgId, {
            content:
              'No relevant excerpts found for that question. Try rephrasing or asking about a different topic from the book.',
            streaming: false,
          });
          setState('idle');
          return;
        }
        if (result.kind === 'embed-failed') {
          setFailure({ reason: 'server', status: 500 });
          await a.finalize(assistantMsgId, {
            content: '',
            streaming: false,
            truncated: true,
          });
          setState('error');
          return;
        }

        const refs: ContextRef[] = result.bundle.includedChunkIds.map((id) => ({
          kind: 'chunk',
          chunkId: id,
        }));
        await a.patch(assistantMsgId, { contextRefs: refs });

        const assembled = assembleRetrievalChatPrompt({
          book: a.book,
          history: a.history,
          newUserText: userText,
          bundle: result.bundle,
        });
        const factory = a.streamFactory ?? streamChatCompletion;
        const machine = makeChatRequestMachine({
          streamFactory: (assembled2, modelId, signal) =>
            factory({ apiKey, modelId, messages: assembled2.messages, signal }),
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
      })();
      return;
    }

    // Passage and open-mode paths (unchanged from Phase 4.4).
    const assistantContextRefs: readonly ContextRef[] = isPassage
      ? [
          {
            kind: 'passage',
            text: passage.text,
            anchor: passage.anchor,
            ...(passage.sectionTitle !== undefined && { sectionTitle: passage.sectionTitle }),
            ...(passage.windowBefore !== undefined && { windowBefore: passage.windowBefore }),
            ...(passage.windowAfter !== undefined && { windowAfter: passage.windowAfter }),
          },
        ]
      : [];

    void a.append({
      id: userMsgId,
      threadId: a.threadId,
      role: 'user',
      content: userText,
      mode: isPassage ? 'passage' : 'open',
      contextRefs: [],
      createdAt: now,
    });
    void a.append({
      id: assistantMsgId,
      threadId: a.threadId,
      role: 'assistant',
      content: '',
      mode: isPassage ? 'passage' : 'open',
      contextRefs: assistantContextRefs,
      streaming: true,
      createdAt: nowPlus,
    });

    const assembled = isPassage
      ? assemblePassageChatPrompt({
          book: a.book,
          history: a.history,
          newUserText: userText,
          passage: {
            text: passage.text,
            ...(passage.windowBefore !== undefined && { windowBefore: passage.windowBefore }),
            ...(passage.windowAfter !== undefined && { windowAfter: passage.windowAfter }),
            ...(passage.sectionTitle !== undefined && { sectionTitle: passage.sectionTitle }),
          },
        })
      : assembleOpenChatPrompt({
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
