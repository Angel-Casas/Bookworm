import type { Book } from '@/domain';
import './indexing-inspector.css';

type Props = {
  readonly book: Book;
  readonly onOpenInspector: () => void;
  readonly onRetry: () => void;
  // When the failure is auth-related ('embedding-no-key'), the card surfaces
  // an "Open Settings" affordance. Optional so callers without a settings
  // navigation handler still get the generic Retry-only UI.
  readonly onOpenSettings?: () => void;
};

type FailedReasonCopy = {
  readonly headline: string;
  readonly tooltip: string;
  readonly hint?: string;
};

function describeFailure(reason: string): FailedReasonCopy {
  switch (reason) {
    case 'embedding-no-key':
      return {
        headline: 'API key required',
        tooltip: 'No API key configured, or your saved key is locked.',
        hint: 'Add or unlock your key in Settings, then click Retry.',
      };
    case 'embedding-insufficient-balance':
      return {
        headline: 'Top up your account',
        tooltip: 'Embedding requires a non-zero NanoGPT balance.',
        hint: 'Add credit at nano-gpt.com, then click Retry.',
      };
    case 'embedding-rate-limited':
      return {
        headline: 'Rate limited',
        tooltip: 'Too many requests in a short window.',
        hint: 'Wait a moment, then click Retry.',
      };
    default:
      return {
        headline: "Couldn't index",
        tooltip: reason,
      };
  }
}

export function BookCardIndexingStatus({
  book,
  onOpenInspector,
  onRetry,
  onOpenSettings,
}: Props) {
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
    case 'failed': {
      const copy = describeFailure(status.reason);
      const showSettings =
        status.reason === 'embedding-no-key' && onOpenSettings !== undefined;
      return (
        <div className="book-card-indexing-status">
          <span aria-hidden="true">⚠</span>
          <span title={copy.tooltip}>{copy.headline}</span>
          {showSettings ? (
            <button
              type="button"
              className="book-card-indexing-status__action"
              onClick={onOpenSettings}
            >
              Open Settings
            </button>
          ) : null}
          <button
            type="button"
            className="book-card-indexing-status__retry"
            onClick={onRetry}
            aria-describedby="retry-reason"
          >
            Retry
          </button>
          <span id="retry-reason" className="visually-hidden">
            {copy.hint ?? `Reason: ${status.reason}`}
          </span>
        </div>
      );
    }
  }
}
