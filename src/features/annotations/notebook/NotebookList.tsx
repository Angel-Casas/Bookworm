import type { Bookmark, Highlight, HighlightColor } from '@/domain/annotations/types';
import type { LocationAnchor } from '@/domain';
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
};

export function NotebookList({
  entries,
  nowMs,
  onJumpToAnchor,
  onRemoveBookmark,
  onRemoveHighlight,
  onChangeColor,
  onSaveNote,
}: Props) {
  return (
    <ul className="notebook-list">
      {entries.map((entry) => (
        <NotebookRow
          key={entry.kind === 'bookmark' ? entry.bookmark.id : entry.highlight.id}
          entry={entry}
          {...(nowMs !== undefined && { nowMs })}
          onJumpToAnchor={onJumpToAnchor}
          onRemoveBookmark={onRemoveBookmark}
          onRemoveHighlight={onRemoveHighlight}
          onChangeColor={onChangeColor}
          onSaveNote={onSaveNote}
        />
      ))}
    </ul>
  );
}
