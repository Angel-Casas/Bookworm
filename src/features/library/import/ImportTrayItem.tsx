import type { BookId } from '@/domain';
import type { ImportEntry } from './importStore';

type Props = {
  readonly entry: ImportEntry;
  readonly onDismiss: (id: string) => void;
  readonly onViewExisting: (bookId: BookId) => void;
};

function statusLabel(entry: ImportEntry): string {
  switch (entry.status.kind) {
    case 'waiting':
      return 'Waiting…';
    case 'running':
      return 'Importing…';
    case 'done':
      return 'Imported';
    case 'duplicate':
      return 'Already in your library';
    case 'failed':
      return entry.status.reason;
  }
}

export function ImportTrayItem({ entry, onDismiss, onViewExisting }: Props) {
  const status = entry.status;
  return (
    <li className={`import-tray__item import-tray__item--${status.kind}`}>
      <div className="import-tray__icon" aria-hidden="true">
        {status.kind === 'waiting' && '◌'}
        {status.kind === 'running' && '◐'}
        {status.kind === 'done' && '✓'}
        {status.kind === 'duplicate' && '↺'}
        {status.kind === 'failed' && '!'}
      </div>
      <div className="import-tray__body">
        <div className="import-tray__name">{entry.fileName}</div>
        <div className="import-tray__status">{statusLabel(entry)}</div>
      </div>
      {status.kind === 'duplicate' && (
        <button
          type="button"
          className="import-tray__action"
          onClick={() => {
            onViewExisting(status.existingBookId);
          }}
        >
          View existing
        </button>
      )}
      {(status.kind === 'failed' || status.kind === 'duplicate') && (
        <button
          type="button"
          className="import-tray__dismiss"
          onClick={() => {
            onDismiss(entry.id);
          }}
        >
          Remove
        </button>
      )}
    </li>
  );
}
