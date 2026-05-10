export const VIEW_TRANSITION_READER_ROOT = 'reader-root';
export const VIEW_TRANSITION_NOTEBOOK_ROOT = 'notebook-root';
export const VIEW_TRANSITION_PANEL_ROOT = 'panel-root';
export const VIEW_TRANSITION_MODAL_ROOT = 'modal-root';

/**
 * Builds the per-instance view-transition-name for a library book card.
 * Replaces any character outside `[A-Za-z0-9_-]` with `-` so the value
 * is a valid CSS identifier suffix.
 */
export function libraryCardViewTransitionName(bookId: string): string {
  const safe = bookId.replace(/[^A-Za-z0-9_-]+/g, '-');
  return `library-card-${safe}`;
}
