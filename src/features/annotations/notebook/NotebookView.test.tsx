import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NotebookView } from './NotebookView';
import * as triggerDownloadModule from './triggerDownload';
import { BookId, BookmarkId, HighlightId, IsoTimestamp } from '@/domain';
import type { Bookmark, Highlight, Note, LocationAnchor } from '@/domain';
import type { BookmarksRepository, HighlightsRepository, NotesRepository } from '@/storage';

afterEach(cleanup);

function fakeBookmarksRepo(initial: Bookmark[] = []): BookmarksRepository {
  return {
    add: vi.fn(() => Promise.resolve()),
    patch: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve(initial)),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}
function fakeHighlightsRepo(initial: Highlight[] = []): HighlightsRepository {
  return {
    add: vi.fn(() => Promise.resolve()),
    patch: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve(initial)),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}
function fakeNotesRepo(initial: Note[] = []): NotesRepository {
  return {
    upsert: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve(initial)),
    getByHighlight: vi.fn(() => Promise.resolve(null)),
    deleteByHighlight: vi.fn(() => Promise.resolve()),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

const NOW = '2026-05-04T12:00:00.000Z';

function bm(id: string, page: number, snippet: string): Bookmark {
  return {
    id: BookmarkId(id),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page },
    snippet,
    sectionTitle: null,
    createdAt: IsoTimestamp(NOW),
  };
}

function hl(id: string, page: number, selectedText: string): Highlight {
  return {
    id: HighlightId(id),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page, rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    selectedText,
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(NOW),
  };
}

function setup(
  opts: {
    bookmarks?: Bookmark[];
    highlights?: Highlight[];
    notes?: Note[];
    onBack?: () => void;
    onJumpToAnchor?: (anchor: LocationAnchor) => void;
  } = {},
) {
  return render(
    <NotebookView
      bookId="b1"
      bookTitle="Test Book"
      bookmarksRepo={fakeBookmarksRepo(opts.bookmarks)}
      highlightsRepo={fakeHighlightsRepo(opts.highlights)}
      notesRepo={fakeNotesRepo(opts.notes)}
      onBack={opts.onBack ?? (() => undefined)}
      onJumpToAnchor={opts.onJumpToAnchor ?? (() => undefined)}
    />,
  );
}

describe('NotebookView', () => {
  it('renders chrome + search bar + empty state when no annotations', async () => {
    setup();
    expect(screen.getByText(/Notebook/)).toBeInTheDocument();
    expect(screen.getByText('Test Book')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/no annotations yet/i)).toBeInTheDocument();
    });
  });

  it('renders rows when annotations exist; renders no-matches when filter excludes', async () => {
    setup({
      bookmarks: [bm('b-1', 1, 'apple')],
      highlights: [hl('h-1', 2, 'banana')],
    });
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /^notes$/i }));
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('back button calls onBack', () => {
    const onBack = vi.fn();
    setup({ onBack });
    fireEvent.click(screen.getByRole('button', { name: /back to reader/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('row content click calls onJumpToAnchor with projected LocationAnchor', async () => {
    const onJumpToAnchor = vi.fn();
    setup({ highlights: [hl('h-1', 7, 'x')], onJumpToAnchor });
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('button', { name: /^Highlight$/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 7 });
  });

  it('clicking Export downloads a Markdown file with the right content + filename', async () => {
    const downloadSpy = vi
      .spyOn(triggerDownloadModule, 'triggerDownload')
      .mockImplementation(() => undefined);
    render(
      <NotebookView
        bookId="b1"
        bookTitle="Pride and Prejudice"
        bookmarksRepo={fakeBookmarksRepo([bm('b-1', 1, 'a quiet quote')])}
        highlightsRepo={fakeHighlightsRepo()}
        notesRepo={fakeNotesRepo()}
        onBack={() => undefined}
        onJumpToAnchor={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export notebook/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /export notebook/i }));
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const call = downloadSpy.mock.calls[0];
    expect(call?.[0]).toContain('# Pride and Prejudice');
    expect(call?.[0]).toContain('a quiet quote');
    expect(call?.[1]).toBe('pride-and-prejudice-notebook.md');
    downloadSpy.mockRestore();
  });
});
