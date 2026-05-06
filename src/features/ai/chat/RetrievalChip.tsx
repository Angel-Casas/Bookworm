type Props = {
  readonly onDismiss: () => void;
};

export function RetrievalChip({ onDismiss }: Props) {
  return (
    <div
      className="retrieval-chip"
      role="status"
      aria-live="polite"
      aria-label="Searching this book for relevant excerpts"
    >
      <span className="retrieval-chip__icon" aria-hidden="true">
        🔍
      </span>
      <span className="retrieval-chip__body">
        <span className="retrieval-chip__text">Searching this book</span>
      </span>
      <button
        type="button"
        className="retrieval-chip__dismiss"
        aria-label="Dismiss book search"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
