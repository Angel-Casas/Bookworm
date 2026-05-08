import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookId,
  ChatThreadId,
  IsoTimestamp,
  type BookFormat,
  type ChatMessage,
  type ChatMessageId,
  type ChatThread,
  type TocEntry,
} from '@/domain';
import { useBookProfile, type ProfileGenerationDeps } from '@/features/ai/prompts';
import type { ApiKeyState } from '@/features/ai/key/apiKeyStore';
import type {
  ChatMessagesRepository,
  ChatThreadsRepository,
  SavedAnswersRepository,
} from '@/storage';
import { useChatThreads } from './useChatThreads';
import { useChatMessages } from './useChatMessages';
import {
  useChatSend,
  type AttachedPassage,
  type AttachedRetrieval,
  type AttachedChapter,
} from './useChatSend';
import type { HighlightAnchor } from '@/domain/annotations/types';
import type { ChunkId, LocationAnchor } from '@/domain';
import type { RetrievalDeps } from '@/features/ai/retrieval/runRetrieval';
import { RetrievalChip } from './RetrievalChip';
import { ChapterChip } from './ChapterChip';
import { useSavedAnswers } from './useSavedAnswers';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatComposer } from './ChatComposer';
import { PassageChip } from './PassageChip';
import { PrivacyPreview } from './PrivacyPreview';
import { ChatEmptyState } from './ChatEmptyState';
import { SaveAnswerInline } from './SaveAnswerInline';
import { ChatFirstTimeHint } from './ChatFirstTimeHint';
import './chat-panel.css';

type Props = {
  readonly bookId: string;
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
    readonly toc: readonly TocEntry[];
  };
  readonly apiKeyState: ApiKeyState;
  readonly getApiKey: () => string | null;
  readonly selectedModelId: string | null;
  readonly threadsRepo: ChatThreadsRepository;
  readonly messagesRepo: ChatMessagesRepository;
  readonly savedAnswersRepo: SavedAnswersRepository;
  readonly onOpenSettings: () => void;
  // When omitted, ChatHeader hides its own collapse button. Used in desktop
  // contexts where the surrounding rail already provides one.
  readonly onCollapse?: () => void;
  readonly hintShown: boolean;
  readonly onHintDismiss: () => void;
  // Phase 4.4 passage mode. Optional so non-passage surfaces can mount the
  // panel without wiring the chip; behavior reduces to Phase 4.3 in that case.
  readonly attachedPassage?: AttachedPassage | null;
  readonly onClearAttachedPassage?: () => void;
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly onClearAttachedRetrieval?: () => void;
  readonly onToggleSearch?: () => void;
  // Phase 5.4 chapter mode. Mutually exclusive with passage and retrieval
  // (priority in render: retrieval > chapter > passage).
  readonly attachedChapter?: AttachedChapter | null;
  readonly onClearAttachedChapter?: () => void;
  readonly onToggleChapter?: () => void;
  readonly chapterAttached?: boolean;
  readonly chapterAttachable?: boolean;
  readonly retrievalDeps?: RetrievalDeps;
  readonly profileDeps?: ProfileGenerationDeps;
  readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
  // When provided, MessageBubble's source footer can navigate the reader to
  // a saved-passage anchor. Workspace passes its goToAnchor here.
  readonly onJumpToReaderAnchor?: (anchor: HighlightAnchor | LocationAnchor) => void;
  // One-shot focus request: when .current === true, the composer textarea
  // focuses on next render and the flag self-clears. Used by Ask AI.
  readonly composerFocusRef?: { current: boolean };
  // One-shot prefill ref drained by ChatComposer on next render. When omitted,
  // ChatPanel falls back to a local ref so the component is usable in
  // isolation (e.g., unit tests). Used by suggested-prompts ✎ icon.
  readonly composerInitialTextRef?: { current: string | null };
};

const DRAFT_THREAD_ID = ChatThreadId('__draft__');
const TITLE_MAX = 60;

function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (trimmed.length <= TITLE_MAX) return trimmed;
  const cut = trimmed.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
}

function nextThreadId(): string {
  return `t-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatPanel(props: Props) {
  const bookIdBranded = BookId(props.bookId);

  const threads = useChatThreads({
    bookId: bookIdBranded,
    threadsRepo: props.threadsRepo,
    messagesRepo: props.messagesRepo,
  });

  const activeThreadId = threads.activeId ?? DRAFT_THREAD_ID;

  const messages = useChatMessages({
    threadId: activeThreadId,
    messagesRepo: props.messagesRepo,
  });

  const attachedPassage = props.attachedPassage ?? null;
  const attachedRetrieval = props.attachedRetrieval ?? null;
  const attachedChapter = props.attachedChapter ?? null;

  const send = useChatSend({
    threadId: activeThreadId,
    modelId: props.selectedModelId ?? '',
    getApiKey: props.getApiKey,
    book: props.book,
    history: messages.list,
    append: messages.append,
    patch: messages.patch,
    finalize: messages.finalize,
    attachedPassage,
    attachedRetrieval,
    attachedChapter,
    ...(props.retrievalDeps !== undefined && { retrievalDeps: props.retrievalDeps }),
  });

  const savedAnswers = useSavedAnswers({
    bookId: bookIdBranded,
    savedAnswersRepo: props.savedAnswersRepo,
  });

  const [savingMessageId, setSavingMessageId] = useState<ChatMessageId | null>(null);

  const handleSendNew = useCallback(
    (text: string): void => {
      void (async () => {
        if (threads.draft && threads.activeId === null) {
          const id = ChatThreadId(nextThreadId());
          const now = IsoTimestamp(new Date().toISOString());
          const thread: ChatThread = {
            id,
            bookId: bookIdBranded,
            title: deriveTitle(text),
            modelId: threads.draft.modelId || (props.selectedModelId ?? ''),
            answerStyle: 'open',
            createdAt: now,
            updatedAt: now,
          };
          await threads.persistDraft(thread);
          // Pass the freshly-created id explicitly. `send.send` reads
          // args.threadId via argsRef, but argsRef hasn't been updated yet —
          // React schedules a re-render on persistDraft's setActiveId(id),
          // and our useEffect that refreshes argsRef only fires after that
          // commit. Without the override, every first message of a new
          // thread persists under the draft sentinel and orphans there.
          send.send(text, id);
          return;
        }
        send.send(text);
      })();
    },
    [threads, bookIdBranded, send, props.selectedModelId],
  );

  // One-time cleanup of pre-fix orphan messages persisted under the draft
  // sentinel. After this PR ships, no new messages should ever land under
  // DRAFT_THREAD_ID — handleSendNew always passes the real id explicitly.
  // So any rows that exist under the sentinel are stale and safe to remove.
  // Best-effort: if the delete fails, the orphans simply remain hidden
  // because no real thread points at the sentinel.
  useEffect(() => {
    void props.messagesRepo.deleteByThread(DRAFT_THREAD_ID).catch(() => undefined);
  }, [props.messagesRepo]);

  type Variant = 'no-key' | 'no-model' | 'no-threads' | 'ready';
  const variant: Variant = useMemo(() => {
    if (props.apiKeyState.kind === 'none' || props.apiKeyState.kind === 'locked') return 'no-key';
    if (props.selectedModelId === null || props.selectedModelId === '') return 'no-model';
    if (threads.list.length === 0 && threads.draft === null) return 'no-threads';
    return 'ready';
  }, [props.apiKeyState.kind, props.selectedModelId, threads.list.length, threads.draft]);

  const localComposerInitialTextRef = useRef<string | null>(null);
  const composerInitialTextRef = props.composerInitialTextRef ?? localComposerInitialTextRef;

  const profile = useBookProfile({
    book: {
      id: bookIdBranded,
      title: props.book.title,
      ...(props.book.author !== undefined ? { author: props.book.author } : {}),
      toc: props.book.toc,
    },
    modelId: props.selectedModelId,
    enabled: variant === 'no-threads' && props.profileDeps !== undefined,
    deps: props.profileDeps ?? {
      // No-op deps used only when enabled=false; useBookProfile early-returns
      // before touching them. Keeps profileDeps optional at the prop boundary.
      chunksRepo: {} as never,
      profilesRepo: {} as never,
      structuredClient: { complete: () => Promise.reject(new Error('no profileDeps')) },
    },
  });

  const composerFocusRef = props.composerFocusRef;
  const handleFillComposer = useCallback(
    (text: string): void => {
      composerInitialTextRef.current = text;
      if (composerFocusRef !== undefined) {
        composerFocusRef.current = true;
      }
    },
    [composerFocusRef],
  );

  const targetMessage =
    savingMessageId !== null ? messages.list.find((m) => m.id === savingMessageId) : undefined;
  const targetUserMessage =
    targetMessage !== undefined
      ? findPreviousUser(messages.list, targetMessage)
      : undefined;

  // Wrap thread switching so attached passage chips don't follow the user
  // into a different conversation. Sticky-across-sends; cleared on switch.
  const handleSelectThread = useCallback(
    (id: ChatThreadId): void => {
      props.onClearAttachedPassage?.();
      props.onClearAttachedRetrieval?.();
      threads.setActive(id);
    },
    // threads.setActive identity is stable per useChatThreads hook contract;
    // re-binding when the callback changes is acceptable here.
    [threads, props],
  );

  return (
    <div className="chat-panel">
      <ChatHeader
        threads={threads.list}
        activeId={threads.activeId}
        {...(threads.draft ? { draftTitleHint: 'New conversation' } : {})}
        onSelectThread={handleSelectThread}
        onRenameThread={(id, title) => {
          void threads.rename(id, title);
        }}
        onDeleteThread={(id) => {
          void threads.remove(id);
        }}
        onStartDraft={() => {
          threads.startDraft(props.selectedModelId ?? '');
        }}
        {...(props.onCollapse !== undefined && { onCollapse: props.onCollapse })}
      />
      <ChatFirstTimeHint
        visible={!props.hintShown && variant === 'ready'}
        onDismiss={props.onHintDismiss}
      />
      <div className="chat-panel__body">
        {variant === 'no-key' || variant === 'no-model' ? (
          <ChatEmptyState
            variant={variant}
            onOpenSettings={props.onOpenSettings}
            bookTitle={props.book.title}
          />
        ) : variant === 'no-threads' ? (
          <ChatEmptyState
            variant="no-threads"
            onStartDraft={() => {
              threads.startDraft(props.selectedModelId ?? '');
            }}
            bookTitle={props.book.title}
            promptsState={profile}
            onSelectPrompt={handleSendNew}
            onEditPrompt={handleFillComposer}
          />
        ) : (
          <MessageList
            messages={messages.list}
            failure={send.failure}
            onSaveMessage={(id) => {
              setSavingMessageId(id);
            }}
            onRetry={send.retry}
            onOpenSettings={props.onOpenSettings}
            {...(props.onJumpToReaderAnchor && { onJumpToSource: props.onJumpToReaderAnchor })}
            {...(props.resolveChunkAnchor && { resolveChunkAnchor: props.resolveChunkAnchor })}
          />
        )}
      </div>
      {savingMessageId !== null && targetMessage ? (
        <SaveAnswerInline
          onSave={async (note) => {
            await savedAnswers.add({
              threadId: targetMessage.threadId,
              messageId: targetMessage.id,
              modelId: props.selectedModelId ?? '',
              mode: targetMessage.mode ?? 'open',
              content: targetMessage.content,
              question: (targetUserMessage?.content ?? '').slice(0, 240),
              contextRefs: targetMessage.contextRefs,
              ...(note ? { userNote: note } : {}),
            });
            setSavingMessageId(null);
          }}
          onCancel={() => {
            setSavingMessageId(null);
          }}
        />
      ) : null}
      {variant === 'ready' || variant === 'no-threads' ? (
        <>
          {attachedRetrieval !== null && props.onClearAttachedRetrieval ? (
            <RetrievalChip onDismiss={props.onClearAttachedRetrieval} />
          ) : attachedChapter !== null && props.onClearAttachedChapter ? (
            <ChapterChip
              sectionTitle={attachedChapter.sectionTitle}
              chunkCount={attachedChapter.chunks.length}
              highlightCount={attachedChapter.highlights.length}
              noteCount={attachedChapter.notes.length}
              onDismiss={props.onClearAttachedChapter}
            />
          ) : attachedPassage !== null && props.onClearAttachedPassage ? (
            <PassageChip
              text={attachedPassage.text}
              {...(attachedPassage.sectionTitle !== undefined && {
                sectionTitle: attachedPassage.sectionTitle,
              })}
              onDismiss={props.onClearAttachedPassage}
            />
          ) : null}
          <PrivacyPreview
            book={props.book}
            modelId={props.selectedModelId ?? ''}
            historyCount={messages.list.length}
            attachedPassage={attachedPassage}
            attachedRetrieval={attachedRetrieval}
            {...(props.retrievalDeps?.chunksRepo !== undefined && {
              chunksRepo: props.retrievalDeps.chunksRepo,
            })}
            {...(props.retrievalDeps?.embeddingsRepo !== undefined && {
              embeddingsRepo: props.retrievalDeps.embeddingsRepo,
            })}
          />
          <ChatComposer
            disabled={false}
            streaming={send.state === 'streaming'}
            placeholder={`Ask about ${props.book.title}`}
            onSend={(text) => {
              handleSendNew(text);
            }}
            onCancel={send.cancel}
            initialTextRef={composerInitialTextRef}
            {...(props.composerFocusRef && { focusRequest: props.composerFocusRef })}
            {...(props.onToggleSearch !== undefined && {
              onToggleSearch: props.onToggleSearch,
            })}
            retrievalAttached={attachedRetrieval !== null}
            {...(props.onToggleChapter !== undefined && {
              onToggleChapter: props.onToggleChapter,
            })}
            {...(props.chapterAttached !== undefined && {
              chapterAttached: props.chapterAttached,
            })}
            {...(props.chapterAttachable !== undefined && {
              chapterAttachable: props.chapterAttachable,
            })}
          />
        </>
      ) : null}
    </div>
  );
}

function findPreviousUser(
  list: readonly ChatMessage[],
  target: ChatMessage,
): ChatMessage | undefined {
  const idx = list.indexOf(target);
  if (idx <= 0) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.role === 'user') return m;
  }
  return undefined;
}
