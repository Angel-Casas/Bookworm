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

  // Close the editor when the user clicks outside it. Save if the content
  // changed; otherwise just dismiss.
  //
  // Three sources of "outside click" need to be covered:
  //   1. The textarea's own onBlur — fires when focus moves to another
  //      focusable element (button, link, etc.).
  //   2. mousedown on the parent document — covers clicks on non-focusable
  //      elements outside the iframe (chrome, rail, page body), which
  //      don't move focus and so don't fire blur.
  //   3. mousedown on each same-origin iframe document — events inside the
  //      EPUB iframe don't bubble to the parent document, so a click on
  //      the book page text is invisible to (2). We attach to each
  //      iframe's contentDocument as well.
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

    const attachedDocs: Document[] = [];
    for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          doc.addEventListener('mousedown', onMouseDown);
          attachedDocs.push(doc);
        }
      } catch {
        // Cross-origin iframe — can't attach. Acceptable: those iframes
        // are not the EPUB reader (which is same-origin Blob URL).
      }
    }

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      for (const doc of attachedDocs) {
        doc.removeEventListener('mousedown', onMouseDown);
      }
    };
  }, [initialContent, onSave, onCancel]);

  const handleBlur = (): void => {
    const trimmed = value.trim();
    if (trimmed !== initialContent.trim()) {
      onSave(trimmed);
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
    <div ref={rootRef} className="note-editor" role="group" aria-label="Edit note">
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
