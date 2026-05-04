import { useState } from 'react';
import type { Highlight, HighlightColor, Note } from '@/domain/annotations/types';
import type { HighlightId } from '@/domain';
import { relativeTime } from '@/shared/text/relativeTime';
import { HIGHLIGHT_COLORS, COLOR_HEX } from './highlightColors';
import { NoteEditor } from './NoteEditor';
import './highlights-panel.css';

type Props = {
  readonly highlights: readonly Highlight[];
  readonly notesByHighlightId: ReadonlyMap<HighlightId, Note>;
  readonly onSelect: (h: Highlight) => void;
  readonly onDelete: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;
  readonly hintShown: boolean;
  readonly onHintDismissed: () => void;
  readonly nowMs?: number;
};

export function HighlightsPanel({
  highlights,
  notesByHighlightId,
  onSelect,
  onDelete,
  onChangeColor,
  onSaveNote,
  hintShown,
  onHintDismissed,
  nowMs,
}: Props) {
  const [editingNoteFor, setEditingNoteFor] = useState<HighlightId | null>(null);

  if (highlights.length === 0) {
    return (
      <aside className="highlights-panel highlights-panel--empty" aria-label="Highlights">
        <p className="highlights-panel__empty-icon" aria-hidden="true">
          ✎
        </p>
        <p className="highlights-panel__empty-title">No highlights yet</p>
        <p className="highlights-panel__empty-hint">
          Select text in the reader and tap a color.
        </p>
      </aside>
    );
  }

  return (
    <aside className="highlights-panel" aria-label="Highlights">
      <ul className="highlights-panel__list">
        {highlights.map((h) => {
          const note = notesByHighlightId.get(h.id);
          const isEditing = editingNoteFor === h.id;
          const noteLabel = isEditing
            ? 'Cancel note'
            : note
              ? 'Edit note'
              : 'Add note';
          return (
            <li key={h.id} className="highlights-panel__item">
              <span
                className="highlights-panel__bar"
                data-color={h.color}
                style={{ background: COLOR_HEX[h.color] }}
                aria-hidden="true"
              />
              <button
                type="button"
                className="highlights-panel__row"
                aria-label={h.sectionTitle ?? '—'}
                onClick={() => {
                  if (isEditing) return;
                  onSelect(h);
                }}
              >
                <span className="highlights-panel__top">
                  <span className="highlights-panel__section">
                    {h.sectionTitle ?? '—'}
                  </span>
                  <span className="highlights-panel__time">
                    {relativeTime(h.createdAt, nowMs)}
                  </span>
                </span>
                <span className="highlights-panel__text">{h.selectedText}</span>
              </button>
              {!isEditing && note ? (
                <button
                  type="button"
                  className="highlights-panel__note-line"
                  data-testid="note-line"
                  onClick={() => {
                    setEditingNoteFor(h.id);
                  }}
                >
                  {note.content}
                </button>
              ) : null}
              {isEditing ? (
                <div className="highlights-panel__editor">
                  <NoteEditor
                    initialContent={note?.content ?? ''}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- entering edit mode is an explicit user action; focus is the desired outcome
                    autoFocus
                    hintShown={hintShown}
                    onHintDismissed={onHintDismissed}
                    onSave={(content) => {
                      onSaveNote(h, content);
                      setEditingNoteFor(null);
                    }}
                    onCancel={() => {
                      setEditingNoteFor(null);
                    }}
                  />
                </div>
              ) : null}
              <span className="highlights-panel__actions">
                {!isEditing
                  ? HIGHLIGHT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="highlights-panel__color"
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
                    isEditing
                      ? 'highlights-panel__note-btn highlights-panel__note-btn--active'
                      : note
                        ? 'highlights-panel__note-btn highlights-panel__note-btn--has-note'
                        : 'highlights-panel__note-btn'
                  }
                  aria-label={noteLabel}
                  onClick={() => {
                    setEditingNoteFor((cur) => (cur === h.id ? null : h.id));
                  }}
                >
                  <span aria-hidden="true">📝</span>
                </button>
                {!isEditing ? (
                  <button
                    type="button"
                    className="highlights-panel__delete"
                    aria-label="Remove highlight"
                    onClick={() => {
                      onDelete(h);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
