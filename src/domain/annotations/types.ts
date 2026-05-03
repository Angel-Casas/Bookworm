import type { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '../ids';
import type { LocationAnchor } from '../locations';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export type Bookmark = {
  readonly id: BookmarkId;
  readonly bookId: BookId;
  readonly anchor: LocationAnchor;
  readonly snippet: string | null;
  readonly sectionTitle: string | null;
  readonly createdAt: IsoTimestamp;
};

export type HighlightRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type HighlightAnchor =
  | { readonly kind: 'epub-cfi'; readonly cfi: string }
  | {
      readonly kind: 'pdf';
      readonly page: number;
      readonly rects: readonly HighlightRect[];
    };

export type Highlight = {
  readonly id: HighlightId;
  readonly bookId: BookId;
  readonly anchor: HighlightAnchor;
  readonly selectedText: string;
  readonly sectionTitle: string | null;
  readonly color: HighlightColor;
  readonly tags: readonly string[];
  readonly createdAt: IsoTimestamp;
};

export type NoteAnchorRef =
  | { readonly kind: 'highlight'; readonly highlightId: HighlightId }
  | { readonly kind: 'location'; readonly anchor: LocationAnchor };

export type Note = {
  readonly id: NoteId;
  readonly bookId: BookId;
  readonly anchorRef: NoteAnchorRef;
  readonly content: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};
