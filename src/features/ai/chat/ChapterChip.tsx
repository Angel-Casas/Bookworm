import { BookOpenIcon } from '@/shared/icons';

type Props = {
  readonly sectionTitle: string;
  readonly chunkCount: number;
  readonly highlightCount: number;
  readonly noteCount: number;
  readonly onDismiss: () => void;
};

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? `${String(n)} ${singular}` : `${String(n)} ${pluralForm}`;
}

export function ChapterChip({
  sectionTitle,
  chunkCount,
  highlightCount,
  noteCount,
  onDismiss,
}: Props) {
  const parts: string[] = [plural(chunkCount, 'chunk', 'chunks')];
  if (highlightCount > 0) parts.push(plural(highlightCount, 'highlight', 'highlights'));
  if (noteCount > 0) parts.push(plural(noteCount, 'note', 'notes'));
  const counts = parts.join(' · ');
  const ariaLabel = `Attached chapter: ${sectionTitle}, ${counts}`;

  return (
    <div
      className="chapter-chip"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className="chapter-chip__icon" aria-hidden="true">
        <BookOpenIcon size={14} />
      </span>
      <span className="chapter-chip__body">
        <span className="chapter-chip__title">{sectionTitle}</span>
        <span className="chapter-chip__meta">{counts}</span>
      </span>
      <button
        type="button"
        className="chapter-chip__dismiss"
        aria-label={`Clear chapter context (${sectionTitle})`}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
