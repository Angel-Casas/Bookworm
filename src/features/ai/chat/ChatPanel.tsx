import { useCallback, useMemo, useState } from 'react';
import {
  BookId,
  ChatThreadId,
  IsoTimestamp,
  type BookFormat,
  type ChatMessage,
  type ChatMessageId,
  type ChatThread,
} from '@/domain';
import type { ApiKeyState } from '@/features/ai/key/apiKeyStore';
import type {
  ChatMessagesRepository,
  ChatThreadsRepository,
  SavedAnswersRepository,
} from '@/storage';
import { useChatThreads } from './useChatThreads';
import { useChatMessages } from './useChatMessages';
import { useChatSend, type AttachedPassage } from './useChatSend';
import type { HighlightAnchor } from '@/domain/annotations/types';
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
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly apiKeyState: ApiKeyState;
  readonly getApiKey: () => string | null;
  readonly selectedModelId: string | null;
  readonly threadsRepo: ChatThreadsRepository;
  readonly messagesRepo: ChatMessagesRepository;
  readonly savedAnswersRepo: SavedAnswersRepository;
  readonly onOpenSettings: () => void;
  readonly onCollapse: () => void;
  readonly hintShown: boolean;
  readonly onHintDismiss: () => void;
  // Phase 4.4 passage mode. Optional so non-passage surfaces can mount the
  // panel without wiring the chip; behavior reduces to Phase 4.3 in that case.
  readonly attachedPassage?: AttachedPassage | null;
  readonly onClearAttachedPassage?: () => void;
  // When provided, MessageBubble's source footer can navigate the reader to
  // a saved-passage anchor. Workspace passes its goToAnchor here.
  readonly onJumpToReaderAnchor?: (anchor: HighlightAnchor) => void;
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
        }
        send.send(text);
      })();
    },
    [threads, bookIdBranded, send, props.selectedModelId],
  );

  type Variant = 'no-key' | 'no-model' | 'no-threads' | 'ready';
  const variant: Variant = useMemo(() => {
    if (props.apiKeyState.kind === 'none' || props.apiKeyState.kind === 'locked') return 'no-key';
    if (props.selectedModelId === null || props.selectedModelId === '') return 'no-model';
    if (threads.list.length === 0 && threads.draft === null) return 'no-threads';
    return 'ready';
  }, [props.apiKeyState.kind, props.selectedModelId, threads.list.length, threads.draft]);

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
        onCollapse={props.onCollapse}
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
          {attachedPassage !== null && props.onClearAttachedPassage ? (
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
          />
          <ChatComposer
            disabled={false}
            streaming={send.state === 'streaming'}
            placeholder={`Ask about ${props.book.title}`}
            onSend={(text) => {
              handleSendNew(text);
            }}
            onCancel={send.cancel}
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
