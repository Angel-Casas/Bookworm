import { describe, it, expect } from 'vitest';
import {
  VIEW_TRANSITION_READER_ROOT,
  VIEW_TRANSITION_NOTEBOOK_ROOT,
  VIEW_TRANSITION_PANEL_ROOT,
  VIEW_TRANSITION_MODAL_ROOT,
  libraryCardViewTransitionName,
} from './viewTransitionNames';

describe('viewTransitionNames', () => {
  it('exports stable string constants for shared roots', () => {
    expect(VIEW_TRANSITION_READER_ROOT).toBe('reader-root');
    expect(VIEW_TRANSITION_NOTEBOOK_ROOT).toBe('notebook-root');
    expect(VIEW_TRANSITION_PANEL_ROOT).toBe('panel-root');
    expect(VIEW_TRANSITION_MODAL_ROOT).toBe('modal-root');
  });

  it('builds per-instance library-card names from a book id', () => {
    expect(libraryCardViewTransitionName('abc-123')).toBe(
      'library-card-abc-123',
    );
  });

  it('handles ids that contain CSS-unsafe characters by encoding them', () => {
    expect(libraryCardViewTransitionName('book with spaces')).toBe(
      'library-card-book-with-spaces',
    );
  });
});
