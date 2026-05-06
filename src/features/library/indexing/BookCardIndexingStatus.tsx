import type { Book } from '@/domain';
import './indexing-inspector.css';

type Props = {
  readonly book: Book;
  readonly onOpenInspector: () => void;
  readonly onRetry: () => void;
};

export function BookCardIndexingStatus({ book, onOpenInspector, onRetry }: Props) {
  const status = book.indexingStatus;
  switch (status.kind) {
    case 'pending':
      return (
        <div className="book-card-indexing-status">
          <span aria-label="Queued for indexing">·</span>
          <span>Queued for indexing</span>
        </div>
      );
    case 'chunking':
      return (
        <div className="book-card-indexing-status">
          <progress
            className="book-card-indexing-status__progress"
            max={100}
            value={status.progressPercent}
            aria-label={`Indexing ${String(status.progressPercent)}%`}
          />
          <span>Indexing {status.progressPercent}%</span>
        </div>
      );
    case 'embedding':
      return (
        <div className="book-card-indexing-status">
          <span>Preparing for AI…</span>
        </div>
      );
    case 'ready':
      return (
        <div className="book-card-indexing-status">
          <span aria-hidden="true">✓</span>
          <span>Indexed</span>
          <button
            type="button"
            className="book-card-indexing-status__inspector-link"
            aria-label="Open index inspector"
            onClick={onOpenInspector}
          >
            Index inspector
          </button>
        </div>
      );
    case 'failed':
      return (
        <div className="book-card-indexing-status">
          <span aria-hidden="true">⚠</span>
          <span title={status.reason}>Couldn&apos;t index</span>
          <button
            type="button"
            className="book-card-indexing-status__retry"
            onClick={onRetry}
            aria-describedby="retry-reason"
          >
            Retry
          </button>
          <span id="retry-reason" className="visually-hidden">
            Reason: {status.reason}
          </span>
        </div>
      );
  }
}
