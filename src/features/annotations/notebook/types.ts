import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';

export type NotebookEntry =
  | {
      readonly kind: 'bookmark';
      readonly bookmark: Bookmark;
    }
  | {
      readonly kind: 'highlight';
      readonly highlight: Highlight;
      readonly note: Note | null;
    };

export type NotebookFilter = 'all' | 'bookmarks' | 'highlights' | 'notes';
