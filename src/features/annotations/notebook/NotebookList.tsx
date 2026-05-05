import type { Bookmark, Highlight, HighlightColor } from '@/domain/annotations/types';
import type { LocationAnchor, SavedAnswerId } from '@/domain';
import { NotebookRow } from './NotebookRow';
import type { NotebookEntry } from './types';

type Props = {
  readonly entries: readonly NotebookEntry[];
  readonly nowMs?: number;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
  readonly onRemoveBookmark: (b: Bookmark) => void;
  readonly onRemoveHighlight: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;
  readonly onRemoveSavedAnswer?: (id: SavedAnswerId) => void;
};

function entryKey(entry: NotebookEntry): string {
  switch (entry.kind) {
    case 'bookmark':
      return entry.bookmark.id;
    case 'highlight':
      return entry.highlight.id;
    case 'savedAnswer':
      return entry.savedAnswer.id;
  }
}

export function NotebookList({
  entries,
  nowMs,
  onJumpToAnchor,
  onRemoveBookmark,
  onRemoveHighlight,
  onChangeColor,
  onSaveNote,
  onRemoveSavedAnswer,
}: Props) {
  return (
    <ul className="notebook-list">
      {entries.map((entry) => (
        <NotebookRow
          key={entryKey(entry)}
          entry={entry}
          {...(nowMs !== undefined && { nowMs })}
          onJumpToAnchor={onJumpToAnchor}
          onRemoveBookmark={onRemoveBookmark}
          onRemoveHighlight={onRemoveHighlight}
          onChangeColor={onChangeColor}
          onSaveNote={onSaveNote}
          {...(onRemoveSavedAnswer ? { onRemoveSavedAnswer } : {})}
        />
      ))}
    </ul>
  );
}
