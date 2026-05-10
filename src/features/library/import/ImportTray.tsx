import { useEffect } from 'react';
import type { BookId } from '@/domain';
import type { ImportEntry, ImportStore } from './importStore';
import { useImportQueue } from './useImportQueue';
import { ImportTrayItem } from './ImportTrayItem';
import './import-tray.css';

type Props = {
  readonly store: ImportStore;
  readonly onViewExisting: (bookId: BookId) => void;
};

function summary(entries: readonly ImportEntry[]): string {
  if (entries.length === 0) return '';
  const running = entries.filter(
    (e) => e.status.kind === 'waiting' || e.status.kind === 'running',
  ).length;
  if (running > 0) return `Importing ${String(running)} ${running === 1 ? 'book' : 'books'}…`;
  const failed = entries.filter((e) => e.status.kind === 'failed').length;
  if (failed > 0) {
    return `Couldn’t import ${String(failed)} ${failed === 1 ? 'book' : 'books'}`;
  }
  const done = entries.filter((e) => e.status.kind === 'done').length;
  return done === 1 ? '1 book imported' : `${String(done)} books imported`;
}

export function ImportTray({ store, onViewExisting }: Props) {
  const { entries, dismiss, clearTerminal } = useImportQueue(store);

  // Auto-clear successful entries after 2s
  useEffect(() => {
    const timers: number[] = [];
    for (const e of entries) {
      if (e.status.kind === 'done') {
        const t = window.setTimeout(() => {
          dismiss(e.id);
        }, 2000);
        timers.push(t);
      }
    }
    return () => {
      timers.forEach((t) => {
        window.clearTimeout(t);
      });
    };
  }, [entries, dismiss]);

  if (entries.length === 0) return null;

  const allTerminal = entries.every(
    (e) => e.status.kind !== 'waiting' && e.status.kind !== 'running',
  );

  return (
    <section className="import-tray motion-rise" aria-label="Import status">
      <header className="import-tray__header">
        <span className="import-tray__summary">{summary(entries)}</span>
        {allTerminal && (
          <button type="button" className="import-tray__clear" onClick={clearTerminal}>
            Clear
          </button>
        )}
      </header>
      <ul className="import-tray__list">
        {entries.map((e) => (
          <ImportTrayItem
            key={e.id}
            entry={e}
            onDismiss={dismiss}
            onViewExisting={onViewExisting}
          />
        ))}
      </ul>
    </section>
  );
}
