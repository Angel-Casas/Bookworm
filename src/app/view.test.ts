import { describe, it, expect } from 'vitest';
import { LIBRARY_VIEW, readerView, notebookView, type AppView } from './view';

describe('view helpers', () => {
  it('LIBRARY_VIEW is a stable singleton-shape', () => {
    expect(LIBRARY_VIEW).toEqual({ kind: 'library' });
  });

  it('readerView builds a reader AppView', () => {
    expect(readerView('b1')).toEqual({ kind: 'reader', bookId: 'b1' });
  });

  it('notebookView builds a notebook AppView', () => {
    expect(notebookView('b1')).toEqual({ kind: 'notebook', bookId: 'b1' });
  });

  it('AppView narrowing is exhaustive', () => {
    function describeView(view: AppView): string {
      switch (view.kind) {
        case 'library':
          return 'library';
        case 'reader':
          return `reader:${view.bookId}`;
        case 'notebook':
          return `notebook:${view.bookId}`;
        case 'settings':
          return 'settings';
      }
    }
    expect(describeView(LIBRARY_VIEW)).toBe('library');
    expect(describeView(readerView('b1'))).toBe('reader:b1');
    expect(describeView(notebookView('b1'))).toBe('notebook:b1');
  });
});
