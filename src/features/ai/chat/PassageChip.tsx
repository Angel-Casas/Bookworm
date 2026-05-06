type Props = {
  readonly text: string;
  readonly sectionTitle?: string;
  readonly onDismiss: () => void;
};

const DISPLAY_CAP = 80;

function truncate(s: string): string {
  if (s.length <= DISPLAY_CAP) return s;
  return s.slice(0, DISPLAY_CAP).trimEnd() + '…';
}

export function PassageChip({ text, sectionTitle, onDismiss }: Props) {
  const displayText = truncate(text);
  const ariaLabel =
    sectionTitle !== undefined
      ? `Attached passage: ${sectionTitle}, "${text}"`
      : `Attached passage: "${text}"`;

  return (
    <div
      className="passage-chip"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className="passage-chip__icon" aria-hidden="true">
        📎
      </span>
      <span className="passage-chip__body">
        {sectionTitle !== undefined && (
          <span className="passage-chip__section">{sectionTitle}</span>
        )}
        <span className="passage-chip__text">{displayText}</span>
      </span>
      <button
        type="button"
        className="passage-chip__dismiss"
        aria-label="Dismiss attached passage"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
