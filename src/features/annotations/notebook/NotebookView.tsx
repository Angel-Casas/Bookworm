import { BookId, type LocationAnchor } from '@/domain';
import type {
  BookmarksRepository,
  HighlightsRepository,
  NotesRepository,
  SavedAnswersRepository,
} from '@/storage';
import { NotebookChrome } from './NotebookChrome';
import { NotebookSearchBar } from './NotebookSearchBar';
import { NotebookList } from './NotebookList';
import { NotebookEmptyState } from './NotebookEmptyState';
import { useNotebook } from './useNotebook';
import './notebook-view.css';

type Props = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly notesRepo: NotesRepository;
  readonly savedAnswersRepo?: SavedAnswersRepository;
  readonly onBack: () => void;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
};

export function NotebookView(props: Props) {
  const notebook = useNotebook({
    bookId: BookId(props.bookId),
    bookmarksRepo: props.bookmarksRepo,
    highlightsRepo: props.highlightsRepo,
    notesRepo: props.notesRepo,
    ...(props.savedAnswersRepo ? { savedAnswersRepo: props.savedAnswersRepo } : {}),
  });

  return (
    <div className="notebook-view">
      <NotebookChrome bookTitle={props.bookTitle} onBack={props.onBack} />
      <NotebookSearchBar
        query={notebook.query}
        onQueryChange={notebook.setQuery}
        filter={notebook.filter}
        onFilterChange={notebook.setFilter}
      />
      {notebook.entries.length === 0 ? (
        <NotebookEmptyState
          reason={notebook.totalCount === 0 ? 'no-entries' : 'no-matches'}
        />
      ) : (
        <NotebookList
          entries={notebook.entries}
          onJumpToAnchor={props.onJumpToAnchor}
          onRemoveBookmark={(b) => {
            void notebook.removeBookmark(b);
          }}
          onRemoveHighlight={(h) => {
            void notebook.removeHighlight(h);
          }}
          onChangeColor={(h, color) => {
            void notebook.changeColor(h, color);
          }}
          onSaveNote={(h, content) => {
            void notebook.saveNote(h, content);
          }}
          onRemoveSavedAnswer={(id) => {
            void notebook.removeSavedAnswer(id);
          }}
        />
      )}
    </div>
  );
}
