type Props = {
  readonly visible: boolean;
  readonly onDismiss: () => void;
};

export function ChatFirstTimeHint({ visible, onDismiss }: Props) {
  if (!visible) return null;
  return (
    <div className="chat-first-time-hint" role="note">
      <p>
        Selected text becomes context in 4.4 — for now, ask about the book in general.
      </p>
      <button type="button" aria-label="Dismiss hint" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
