import type { TocEntry } from '@/domain';
import './toc-panel.css';

type TocPanelProps = {
  readonly toc: readonly TocEntry[];
  readonly currentEntryId?: string;
  readonly onSelect: (entry: TocEntry) => void;
};

export function TocPanel({ toc, currentEntryId, onSelect }: TocPanelProps) {
  if (toc.length === 0) {
    return (
      <aside className="toc-panel toc-panel--empty">
        <p>No chapters in this book.</p>
      </aside>
    );
  }
  return (
    <aside className="toc-panel" aria-label="Table of contents">
      <ul className="toc-panel__list">
        {toc.map((entry) => {
          const isCurrent = entry.id === currentEntryId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`toc-panel__entry${isCurrent ? ' toc-panel__entry--current' : ''}`}
                style={{ paddingInlineStart: `${String(16 + entry.depth * 16)}px` }}
                onClick={() => {
                  onSelect(entry);
                }}
              >
                {entry.title}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
