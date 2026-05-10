import { useEffect, useRef, useState } from 'react';
import './note-editor.css';

const SOFT_LIMIT = 2000;
const COUNTER_VISIBLE_AT = 1600;

type Props = {
  readonly initialContent: string;
  readonly onSave: (content: string) => void;
  readonly onCancel: () => void;
  readonly autoFocus?: boolean;
  readonly placeholder?: string;
};

export function NoteEditor({
  initialContent,
  onSave,
  onCancel,
  autoFocus,
  placeholder = 'Add a note…',
}: Props) {
  const [value, setValue] = useState(initialContent);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // Close the editor when the user clicks outside. Two signals cover the
  // surface area:
  //
  //   1. textarea onBlur — fires whenever the textarea loses focus,
  //      including when the user clicks inside the EPUB iframe (iframe
  //      focus transfer always blurs the parent textarea). Foliate's iframe
  //      is inside a closed shadow DOM, so we can't reach it via
  //      document.querySelectorAll, but we don't need to — blur handles it.
  //
  //   2. document mousedown — covers clicks on non-focusable elements in
  //      the parent document (chrome, rail, page body). These clicks don't
  //      move focus, so the textarea doesn't blur on its own.
  //
  // In both cases: save if content changed, otherwise cancel. Either path
  // closes the editor (parent unmounts on save or cancel).
  useEffect(() => {
    const close = (): void => {
      const trimmed = valueRef.current.trim();
      if (trimmed !== initialContent.trim()) {
        onSave(trimmed);
      } else {
        onCancel();
      }
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [initialContent, onSave, onCancel]);

  const handleBlur = (): void => {
    const trimmed = value.trim();
    if (trimmed !== initialContent.trim()) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    // Save shortcuts: Shift+Enter, Cmd+Enter, Ctrl+Enter. Plain Enter still
    // inserts a newline. (In textareas Shift+Enter is normally a newline too,
    // but plain Enter already serves that purpose, so we repurpose Shift.)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed !== initialContent.trim()) {
        onSave(trimmed);
      } else {
        onCancel();
      }
    }
  };

  const counterVisible = value.length > COUNTER_VISIBLE_AT;
  const counterOver = value.length > SOFT_LIMIT;

  return (
    <div
      ref={rootRef}
      className="note-editor motion-fade-in"
      role="group"
      aria-label="Edit note"
    >
      <textarea
        ref={taRef}
        className="note-editor__textarea"
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {counterVisible ? (
        <span
          className={
            counterOver
              ? 'note-editor__counter note-editor__counter--over'
              : 'note-editor__counter'
          }
          aria-live="polite"
        >
          {value.length} / {SOFT_LIMIT}
        </span>
      ) : null}
      <span className="note-editor__hint">
        Shift+Enter or click outside to save · Esc to discard
      </span>
    </div>
  );
}
