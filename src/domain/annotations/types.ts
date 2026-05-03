import type { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '../ids';
import type { LocationAnchor, LocationRange } from '../locations';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export type Bookmark = {
  readonly id: BookmarkId;
  readonly bookId: BookId;
  readonly anchor: LocationAnchor;
  readonly snippet: string | null;
  readonly sectionTitle: string | null;
  readonly createdAt: IsoTimestamp;
};

export type Highlight = {
  readonly id: HighlightId;
  readonly bookId: BookId;
  readonly range: LocationRange;
  readonly selectedText: string;
  readonly normalizedText: string;
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
