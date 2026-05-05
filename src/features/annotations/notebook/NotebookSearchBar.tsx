import { useEffect, useRef, useState } from 'react';
import type { NotebookFilter } from './types';
import './notebook-search-bar.css';

type Props = {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly filter: NotebookFilter;
  readonly onFilterChange: (f: NotebookFilter) => void;
};

const DEBOUNCE_MS = 150;
const FILTERS: readonly { value: NotebookFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bookmarks', label: 'Bookmarks' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'notes', label: 'Notes' },
  { value: 'ai', label: 'AI answers' },
];

export function NotebookSearchBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
}: Props) {
  const [local, setLocal] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced forward to parent.
  useEffect(() => {
    if (local === query) return;
    const id = window.setTimeout(() => {
      onQueryChange(local);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [local, query, onQueryChange]);

  // Cmd/Ctrl+K focus shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="notebook-search-bar">
      <input
        ref={inputRef}
        type="search"
        className="notebook-search-bar__input"
        placeholder="Search annotations"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
        }}
      />
      <div className="notebook-search-bar__chips" role="toolbar" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={
              f.value === filter
                ? 'notebook-search-bar__chip notebook-search-bar__chip--active'
                : 'notebook-search-bar__chip'
            }
            aria-pressed={f.value === filter}
            onClick={() => {
              onFilterChange(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
