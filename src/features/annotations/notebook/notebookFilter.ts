import type { NotebookEntry, NotebookFilter } from './types';

export function matchesFilter(entry: NotebookEntry, filter: NotebookFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'bookmarks':
      return entry.kind === 'bookmark';
    case 'highlights':
      return entry.kind === 'highlight';
    case 'notes':
      return entry.kind === 'highlight' && entry.note !== null;
    case 'ai':
      return entry.kind === 'savedAnswer';
  }
}
