import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NotebookRow } from './NotebookRow';
import {
  BookId,
  BookmarkId,
  ChatMessageId,
  ChatThreadId,
  HighlightId,
  IsoTimestamp,
  NoteId,
  SavedAnswerId,
} from '@/domain';
import type { ContextRef, SavedAnswer } from '@/domain';
import type { NotebookEntry } from './types';

afterEach(cleanup);

const NOW = new Date('2026-05-04T12:00:00.000Z').getTime();

function bookmarkEntry(): NotebookEntry {
  return {
    kind: 'bookmark',
    bookmark: {
      id: BookmarkId('b-1'),
      bookId: BookId('b1'),
      anchor: { kind: 'pdf', page: 3 },
      snippet: 'It is a truth universally acknowledged...',
      sectionTitle: 'Chapter 1',
      createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    },
  };
}

function highlightEntry(opts: { withNote?: boolean } = {}): NotebookEntry {
  return {
    kind: 'highlight',
    highlight: {
      id: HighlightId('h-1'),
      bookId: BookId('b1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
      selectedText: 'a passage of selected text',
      sectionTitle: 'Chapter 4',
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    },
    note: opts.withNote
      ? {
          id: NoteId('n-1'),
          bookId: BookId('b1'),
          anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
          content: 'a thought about Bingley',
          createdAt: IsoTimestamp(new Date(NOW).toISOString()),
          updatedAt: IsoTimestamp(new Date(NOW).toISOString()),
        }
      : null,
  };
}

function setup(
  entry: NotebookEntry,
  overrides: Partial<React.ComponentProps<typeof NotebookRow>> = {},
) {
  return render(
    <ul>
      <NotebookRow
        entry={entry}
        nowMs={NOW}
        onJumpToAnchor={overrides.onJumpToAnchor ?? (() => undefined)}
        onRemoveBookmark={overrides.onRemoveBookmark ?? (() => undefined)}
        onRemoveHighlight={overrides.onRemoveHighlight ?? (() => undefined)}
        onChangeColor={overrides.onChangeColor ?? (() => undefined)}
        onSaveNote={overrides.onSaveNote ?? (() => undefined)}
      />
    </ul>,
  );
}

describe('NotebookRow — bookmark', () => {
  it('renders BOOKMARK type tag, section, snippet, single delete button', () => {
    setup(bookmarkEntry());
    expect(screen.getByText('BOOKMARK')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText(/truth universally acknowledged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set color to/i })).toBeNull();
  });

  it('clicking content calls onJumpToAnchor with the bookmark anchor', () => {
    const onJumpToAnchor = vi.fn();
    setup(bookmarkEntry(), { onJumpToAnchor });
    fireEvent.click(screen.getByRole('button', { name: /Chapter 1/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 3 });
  });

  it('clicking delete calls onRemoveBookmark and does NOT jump', () => {
    const onJumpToAnchor = vi.fn();
    const onRemoveBookmark = vi.fn();
    setup(bookmarkEntry(), { onJumpToAnchor, onRemoveBookmark });
    fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));
    expect(onRemoveBookmark).toHaveBeenCalled();
    expect(onJumpToAnchor).not.toHaveBeenCalled();
  });
});

describe('NotebookRow — highlight', () => {
  it('renders HIGHLIGHT type tag, section, color bar, color pips, note button, delete', () => {
    const { container } = setup(highlightEntry());
    expect(screen.getByText('HIGHLIGHT')).toBeInTheDocument();
    expect(screen.getByText('Chapter 4')).toBeInTheDocument();
    expect(container.querySelector('.notebook-row__bar[data-color="yellow"]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /set color to/i })).toHaveLength(4);
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove highlight/i })).toBeInTheDocument();
  });

  it('renders NOTE type tag and inline note text when entry has a note', () => {
    setup(highlightEntry({ withNote: true }));
    expect(screen.getByText('NOTE')).toBeInTheDocument();
    expect(screen.getByText(/thought about Bingley/)).toBeInTheDocument();
  });

  it('clicking the note button enters edit mode (NoteEditor renders)', () => {
    setup(highlightEntry());
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('saving content calls onSaveNote(highlight, content)', () => {
    const onSaveNote = vi.fn();
    const entry = highlightEntry();
    setup(entry, { onSaveNote });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'new thought' } });
    fireEvent.blur(ta);
    expect(onSaveNote).toHaveBeenCalledWith(
      entry.kind === 'highlight' ? entry.highlight : null,
      'new thought',
    );
  });

  it('clicking content calls onJumpToAnchor with the projected LocationAnchor', () => {
    const onJumpToAnchor = vi.fn();
    setup(highlightEntry(), { onJumpToAnchor });
    fireEvent.click(screen.getByRole('button', { name: /Chapter 4/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' });
  });

  it('PDF highlight projects to {kind:"pdf", page} (drops rects)', () => {
    const onJumpToAnchor = vi.fn();
    const entry: NotebookEntry = {
      kind: 'highlight',
      highlight: {
        id: HighlightId('h-1'),
        bookId: BookId('b1'),
        anchor: { kind: 'pdf', page: 7, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
        selectedText: 'x',
        sectionTitle: 'p7',
        color: 'yellow',
        tags: [],
        createdAt: IsoTimestamp(new Date(NOW).toISOString()),
      },
      note: null,
    };
    setup(entry, { onJumpToAnchor });
    fireEvent.click(screen.getByRole('button', { name: /p7/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 7 });
  });
});

describe('NotebookRow — savedAnswer Jump-to-passage (Phase 4.4)', () => {
  function savedAnswer(contextRefs: readonly ContextRef[]): SavedAnswer {
    return {
      id: SavedAnswerId('sa-1'),
      bookId: BookId('b1'),
      threadId: ChatThreadId('t-1'),
      messageId: ChatMessageId('m-1'),
      modelId: 'gpt-x',
      mode: contextRefs.some((r) => r.kind === 'passage') ? 'passage' : 'open',
      content: 'The narrator argues that...',
      question: 'What is happening?',
      contextRefs,
      createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    };
  }

  function answerEntry(refs: readonly ContextRef[]): NotebookEntry {
    return { kind: 'savedAnswer', savedAnswer: savedAnswer(refs) };
  }

  const passageAnchor = { kind: 'epub-cfi' as const, cfi: 'epubcfi(/6/4!/4/2)' };

  it('renders Jump-to-passage button when contextRefs has a passage with anchor', () => {
    setup(
      answerEntry([
        {
          kind: 'passage',
          text: 'sel',
          anchor: passageAnchor,
        },
      ]),
    );
    expect(
      screen.getByRole('button', { name: /jump to passage in book/i }),
    ).toBeInTheDocument();
  });

  it('does not render the button for 4.3 saved answers (no passage refs)', () => {
    setup(answerEntry([]));
    expect(screen.queryByRole('button', { name: /jump to passage/i })).toBeNull();
  });

  it('clicking the button calls onJumpToAnchor with the projected LocationAnchor', () => {
    const onJumpToAnchor = vi.fn();
    setup(
      answerEntry([
        { kind: 'passage', text: 'sel', anchor: passageAnchor },
      ]),
      { onJumpToAnchor },
    );
    fireEvent.click(screen.getByRole('button', { name: /jump to passage in book/i }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({
      kind: 'epub-cfi',
      cfi: 'epubcfi(/6/4!/4/2)',
    });
  });

  it('PDF passage anchor projects to {kind:"pdf", page} (drops rects)', () => {
    const onJumpToAnchor = vi.fn();
    setup(
      answerEntry([
        {
          kind: 'passage',
          text: 'sel',
          anchor: {
            kind: 'pdf',
            page: 12,
            rects: [{ x: 1, y: 2, width: 3, height: 4 }],
          },
        },
      ]),
      { onJumpToAnchor },
    );
    fireEvent.click(screen.getByRole('button', { name: /jump to passage in book/i }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 12 });
  });

  // Locks the .find() pattern — Phase 5+ multi-source mode mixes ref kinds.
  it('uses .find() — works when passage is not the first contextRef', () => {
    setup(
      answerEntry([
        { kind: 'highlight', highlightId: HighlightId('h1') },
        { kind: 'passage', text: 'sel', anchor: passageAnchor },
      ]),
    );
    expect(
      screen.getByRole('button', { name: /jump to passage in book/i }),
    ).toBeInTheDocument();
  });
});
