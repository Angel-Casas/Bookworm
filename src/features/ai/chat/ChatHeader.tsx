import { useState } from 'react';
import type { ChatThread, ChatThreadId } from '@/domain';
import { ThreadList } from './ThreadList';

type Props = {
  readonly threads: readonly ChatThread[];
  readonly activeId: ChatThreadId | null;
  readonly draftTitleHint?: string;
  readonly onSelectThread: (id: ChatThreadId) => void;
  readonly onRenameThread: (id: ChatThreadId, title: string) => void;
  readonly onDeleteThread: (id: ChatThreadId) => void;
  readonly onStartDraft: () => void;
  // When omitted, the collapse button is not rendered. Used in desktop
  // contexts where the surrounding rail already provides a collapse
  // affordance (avoids two visually adjacent buttons with the same role).
  readonly onCollapse?: () => void;
  // Phase 6.5: ThreadList renders an error variant with Retry when the
  // underlying useChatThreads load fails.
  readonly threadsLoadError?: Error | null;
  readonly onRetryLoadThreads?: () => void;
};

export function ChatHeader({
  threads,
  activeId,
  draftTitleHint,
  onSelectThread,
  onRenameThread,
  onDeleteThread,
  onStartDraft,
  onCollapse,
  threadsLoadError,
  onRetryLoadThreads,
}: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const active = threads.find((t) => t.id === activeId) ?? null;
  const titleText = active ? active.title : (draftTitleHint ?? 'New conversation');

  return (
    <header className="chat-header">
      <button
        type="button"
        className="chat-header__title"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {titleText} ▾
      </button>
      <div className="chat-header__actions">
        <button type="button" aria-label="New conversation" onClick={onStartDraft}>
          +
        </button>
        {onCollapse ? (
          <button type="button" aria-label="Collapse chat panel" onClick={onCollapse}>
            ›
          </button>
        ) : null}
      </div>
      {open ? (
        <ThreadList
          threads={threads}
          activeId={activeId}
          onSelect={(id) => {
            onSelectThread(id);
            setOpen(false);
          }}
          onRename={(id, title) => {
            onRenameThread(id, title);
          }}
          onDelete={(id) => {
            onDeleteThread(id);
          }}
          onClose={() => {
            setOpen(false);
          }}
          {...(threadsLoadError !== undefined && { loadError: threadsLoadError })}
          {...(onRetryLoadThreads !== undefined && { onRetryLoad: onRetryLoadThreads })}
        />
      ) : null}
    </header>
  );
}
