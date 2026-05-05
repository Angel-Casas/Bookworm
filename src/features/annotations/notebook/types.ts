import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { SavedAnswer } from '@/domain';

export type NotebookEntry =
  | {
      readonly kind: 'bookmark';
      readonly bookmark: Bookmark;
    }
  | {
      readonly kind: 'highlight';
      readonly highlight: Highlight;
      readonly note: Note | null;
    }
  | {
      readonly kind: 'savedAnswer';
      readonly savedAnswer: SavedAnswer;
    };

export type NotebookFilter = 'all' | 'bookmarks' | 'highlights' | 'notes' | 'ai';
