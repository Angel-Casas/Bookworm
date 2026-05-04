import './notebook-empty-state.css';

type Props = { readonly reason: 'no-entries' | 'no-matches' };

export function NotebookEmptyState({ reason }: Props) {
  if (reason === 'no-entries') {
    return (
      <aside className="notebook-empty-state">
        <p className="notebook-empty-state__title">No annotations yet</p>
        <p className="notebook-empty-state__hint">
          Open this book and tap a bookmark, highlight, or note to start.
        </p>
      </aside>
    );
  }
  return (
    <aside className="notebook-empty-state">
      <p className="notebook-empty-state__title">No matches</p>
      <p className="notebook-empty-state__hint">Try a different search or filter.</p>
    </aside>
  );
}
