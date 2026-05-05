import { useEffect, useState } from 'react';
import type { ChatThread, ChatThreadId } from '@/domain';
import './thread-list.css';

type Props = {
  readonly threads: readonly ChatThread[];
  readonly activeId: ChatThreadId | null;
  readonly onSelect: (id: ChatThreadId) => void;
  readonly onRename: (id: ChatThreadId, title: string) => void;
  readonly onDelete: (id: ChatThreadId) => void;
  readonly onClose: () => void;
};

export function ThreadList({
  threads,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [editingId, setEditingId] = useState<ChatThreadId | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>('');

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(threads.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        const t = threads[focusIdx];
        if (t) onSelect(t.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [focusIdx, threads, onSelect, onClose]);

  if (threads.length === 0) {
    return (
      <div className="thread-list" role="listbox" aria-label="Conversations">
        <p className="thread-list__empty">No conversations yet.</p>
      </div>
    );
  }

  return (
    <div className="thread-list" role="listbox" aria-label="Conversations">
      {threads.map((t, i) => (
        <div
          key={t.id}
          role="option"
          aria-selected={t.id === activeId}
          tabIndex={0}
          className={
            'thread-list__row' + (i === focusIdx ? ' thread-list__row--focus' : '')
          }
          onClick={() => {
            onSelect(t.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(t.id);
            }
          }}
        >
          {editingId === t.id ? (
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus the just-opened rename input
              autoFocus
              type="text"
              className="thread-list__edit"
              value={draftTitle}
              aria-label={`Rename conversation ${t.title}`}
              onChange={(e) => {
                setDraftTitle(e.currentTarget.value);
              }}
              onBlur={() => {
                onRename(t.id, draftTitle.trim() || t.title);
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setEditingId(null);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          ) : (
            <button
              type="button"
              className="thread-list__title"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(t.id);
                setDraftTitle(t.title);
              }}
            >
              {t.title}
            </button>
          )}
          <button
            type="button"
            className="thread-list__delete"
            aria-label={`Delete conversation ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
