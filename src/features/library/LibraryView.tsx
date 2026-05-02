import { LibraryEmptyState } from './LibraryEmptyState';

// Phase 0 only renders the empty state. Phase 1 swaps to a bookshelf grid
// once the import flow lands and books exist in storage.
export function LibraryView() {
  return <LibraryEmptyState />;
}
