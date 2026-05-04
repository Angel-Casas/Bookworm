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
  readonly hintShown: boolean;
  readonly onHintDismissed: () => void;
};

export function NoteEditor({
  initialContent,
  onSave,
  onCancel,
  autoFocus,
  placeholder = 'Add a note…',
  hintShown,
  onHintDismissed,
}: Props) {
  const [value, setValue] = useState(initialContent);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  const handleBlur = (): void => {
    const trimmed = value.trim();
    if (trimmed !== initialContent.trim()) {
      onSave(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!hintShown) onHintDismissed();
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      taRef.current?.blur();
    }
  };

  const counterVisible = value.length > COUNTER_VISIBLE_AT;
  const counterOver = value.length > SOFT_LIMIT;

  return (
    <div className="note-editor" role="group" aria-label="Edit note">
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
      {!hintShown ? <span className="note-editor__hint">Esc to discard</span> : null}
    </div>
  );
}
