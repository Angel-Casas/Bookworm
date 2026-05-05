import { useState } from 'react';
import type { Bookmark, Highlight, HighlightColor } from '@/domain/annotations/types';
import type { LocationAnchor, SavedAnswerId } from '@/domain';
import { HIGHLIGHT_COLORS, COLOR_HEX } from '@/features/reader/highlightColors';
import { NoteEditor } from '@/features/reader/NoteEditor';
import { NoteIcon } from '@/shared/icons';
import { relativeTime } from '@/shared/text/relativeTime';
import type { NotebookEntry } from './types';
import './notebook-row.css';

type Props = {
  readonly entry: NotebookEntry;
  readonly nowMs?: number;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
  readonly onRemoveBookmark: (b: Bookmark) => void;
  readonly onRemoveHighlight: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;
  readonly onRemoveSavedAnswer?: (id: SavedAnswerId) => void;
};

function projectHighlightAnchor(h: Highlight): LocationAnchor {
  if (h.anchor.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: h.anchor.cfi };
  return { kind: 'pdf', page: h.anchor.page };
}

export function NotebookRow({
  entry,
  nowMs,
  onJumpToAnchor,
  onRemoveBookmark,
  onRemoveHighlight,
  onChangeColor,
  onSaveNote,
  onRemoveSavedAnswer,
}: Props) {
  const [editingNote, setEditingNote] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (entry.kind === 'savedAnswer') {
    const s = entry.savedAnswer;
    return (
      <li className="notebook-row notebook-row--saved-answer">
        <div className="notebook-row__main">
          <span className="notebook-row__top">
            <span className="notebook-row__type">AI ANSWER</span>
            <span className="notebook-row__model">{s.modelId}</span>
            <span className="notebook-row__time">{relativeTime(s.createdAt, nowMs)}</span>
          </span>
          <p className="notebook-row__question">{s.question}</p>
          <button
            type="button"
            className={
              expanded
                ? 'notebook-row__answer notebook-row__answer--expanded'
                : 'notebook-row__answer'
            }
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((cur) => !cur);
            }}
          >
            {s.content}
          </button>
          {s.userNote ? (
            <p className="notebook-row__user-note">{s.userNote}</p>
          ) : null}
        </div>
        <span className="notebook-row__actions">
          {onRemoveSavedAnswer ? (
            <button
              type="button"
              className="notebook-row__delete"
              aria-label="Remove saved answer"
              onClick={() => {
                onRemoveSavedAnswer(s.id);
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      </li>
    );
  }

  if (entry.kind === 'bookmark') {
    const b = entry.bookmark;
    return (
      <li className="notebook-row notebook-row--bookmark">
        <div className="notebook-row__main">
          <button
            type="button"
            className="notebook-row__content"
            aria-label={b.sectionTitle ?? 'Bookmark'}
            onClick={() => {
              onJumpToAnchor(b.anchor);
            }}
          >
            <span className="notebook-row__top">
              <span className="notebook-row__type">BOOKMARK</span>
              {b.sectionTitle ? (
                <span className="notebook-row__section">{b.sectionTitle}</span>
              ) : null}
              <span className="notebook-row__time">{relativeTime(b.createdAt, nowMs)}</span>
            </span>
            {b.snippet ? <span className="notebook-row__text">{b.snippet}</span> : null}
          </button>
        </div>
        <span className="notebook-row__actions">
          <button
            type="button"
            className="notebook-row__delete"
            aria-label="Remove bookmark"
            onClick={() => {
              onRemoveBookmark(b);
            }}
          >
            ×
          </button>
        </span>
      </li>
    );
  }

  const h = entry.highlight;
  const note = entry.note;
  const noteLabel = editingNote ? 'Cancel note' : note ? 'Edit note' : 'Add note';

  return (
    <li className="notebook-row notebook-row--highlight">
      <span
        className="notebook-row__bar"
        data-color={h.color}
        style={{ background: COLOR_HEX[h.color] }}
        aria-hidden="true"
      />
      <div className="notebook-row__main">
        <button
          type="button"
          className="notebook-row__content"
          aria-label={h.sectionTitle ?? 'Highlight'}
          onClick={() => {
            if (editingNote) return;
            onJumpToAnchor(projectHighlightAnchor(h));
          }}
        >
          <span className="notebook-row__top">
            <span className="notebook-row__type">{note ? 'NOTE' : 'HIGHLIGHT'}</span>
            {h.sectionTitle ? (
              <span className="notebook-row__section">{h.sectionTitle}</span>
            ) : null}
            <span className="notebook-row__time">{relativeTime(h.createdAt, nowMs)}</span>
          </span>
          <span className="notebook-row__text">{h.selectedText}</span>
        </button>
        {!editingNote && note ? (
          <button
            type="button"
            className="notebook-row__note-line"
            data-testid="notebook-note-line"
            onClick={() => {
              setEditingNote(true);
            }}
          >
            {note.content}
          </button>
        ) : null}
        {editingNote ? (
          <div className="notebook-row__editor">
            <NoteEditor
              initialContent={note?.content ?? ''}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- entering edit mode is an explicit user action
              autoFocus
              onSave={(content) => {
                onSaveNote(h, content);
                setEditingNote(false);
              }}
              onCancel={() => {
                setEditingNote(false);
              }}
            />
          </div>
        ) : null}
      </div>
      <span className="notebook-row__actions">
        {!editingNote
          ? HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="notebook-row__color"
                aria-label={`Set color to ${color}`}
                aria-pressed={color === h.color}
                style={{ background: COLOR_HEX[color] }}
                onClick={() => {
                  onChangeColor(h, color);
                }}
              />
            ))
          : null}
        <button
          type="button"
          className={
            editingNote
              ? 'notebook-row__note-btn notebook-row__note-btn--active'
              : note
                ? 'notebook-row__note-btn notebook-row__note-btn--has-note'
                : 'notebook-row__note-btn'
          }
          aria-label={noteLabel}
          onClick={() => {
            setEditingNote((cur) => !cur);
          }}
        >
          <NoteIcon />
        </button>
        {!editingNote ? (
          <button
            type="button"
            className="notebook-row__delete"
            aria-label="Remove highlight"
            onClick={() => {
              onRemoveHighlight(h);
            }}
          >
            ×
          </button>
        ) : null}
      </span>
    </li>
  );
}
