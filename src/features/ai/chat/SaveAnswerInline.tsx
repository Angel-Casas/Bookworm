import { useEffect, useRef, useState } from 'react';

const CONFIRM_DURATION_MS = 2000;

type Props = {
  readonly initialNote?: string;
  readonly onSave: (note: string) => Promise<void>;
  readonly onCancel: () => void;
};

export function SaveAnswerInline({ initialNote = '', onSave, onCancel }: Props) {
  const [note, setNote] = useState<string>(initialNote);
  const [busy, setBusy] = useState<boolean>(false);
  const [confirm, setConfirm] = useState<boolean>(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const handleSave = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(note.trim());
      setConfirm(true);
      confirmTimer.current = setTimeout(() => {
        setConfirm(false);
      }, CONFIRM_DURATION_MS);
    } finally {
      setBusy(false);
    }
  };

  if (confirm) {
    return (
      <p className="save-answer__confirm" role="status">
        Saved → notebook
      </p>
    );
  }
  return (
    <div className="save-answer">
      <textarea
        className="save-answer__note"
        placeholder="Add a note (optional)"
        aria-label="Add a note for this saved answer"
        value={note}
        onChange={(e) => {
          setNote(e.currentTarget.value);
        }}
      />
      <div className="save-answer__actions">
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={busy}
        >
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
