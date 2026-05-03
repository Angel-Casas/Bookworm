import type { Bookmark } from '@/domain/annotations/types';
import { relativeTime } from '@/shared/text/relativeTime';
import './bookmarks-panel.css';

type Props = {
  readonly bookmarks: readonly Bookmark[];
  readonly onSelect: (b: Bookmark) => void;
  readonly onDelete: (b: Bookmark) => void;
  readonly nowMs?: number;
};

export function BookmarksPanel({ bookmarks, onSelect, onDelete, nowMs }: Props) {
  if (bookmarks.length === 0) {
    return (
      <aside className="bookmarks-panel bookmarks-panel--empty" aria-label="Bookmarks">
        <p className="bookmarks-panel__empty-icon" aria-hidden="true">
          ★
        </p>
        <p className="bookmarks-panel__empty-title">No bookmarks yet</p>
        <p className="bookmarks-panel__empty-hint">Tap ★ in the toolbar to mark a spot.</p>
      </aside>
    );
  }
  return (
    <aside className="bookmarks-panel" aria-label="Bookmarks">
      <ul className="bookmarks-panel__list">
        {bookmarks.map((b) => (
          <li key={b.id} className="bookmarks-panel__item">
            <button
              type="button"
              className="bookmarks-panel__row"
              aria-label={b.sectionTitle ?? '—'}
              onClick={() => {
                onSelect(b);
              }}
            >
              <span className="bookmarks-panel__top">
                <span className="bookmarks-panel__star" aria-hidden="true">
                  ★
                </span>
                <span className="bookmarks-panel__section">{b.sectionTitle ?? '—'}</span>
                <span className="bookmarks-panel__time">{relativeTime(b.createdAt, nowMs)}</span>
              </span>
              {b.snippet !== null ? (
                <span className="bookmarks-panel__snippet">{b.snippet}</span>
              ) : null}
            </button>
            <button
              type="button"
              className="bookmarks-panel__delete"
              aria-label="Remove bookmark"
              onClick={() => {
                onDelete(b);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
