import { describe, it, expect } from 'vitest';
import { exportNotebookToMarkdown, slugifyTitle } from './exportMarkdown';
import type { NotebookEntry } from './types';
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
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { SavedAnswer } from '@/domain';

const NOW = new Date('2026-05-09T12:00:00.000Z').getTime();

function bm(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: BookmarkId('b1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
    snippet: 'A bookmarked passage of text.',
    sectionTitle: 'Chapter 1',
    createdAt: IsoTimestamp('2026-05-09T11:50:00.000Z'),
    ...over,
  };
}

function hl(over: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId('h1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)' },
    selectedText: 'A piece of selected text',
    sectionTitle: 'Chapter 2',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-09T11:55:00.000Z'),
    ...over,
  };
}

function noteFor(highlightId: HighlightId, content: string): Note {
  return {
    id: NoteId(`n-${highlightId}`),
    bookId: BookId('book-1'),
    anchorRef: { kind: 'highlight', highlightId },
    content,
    createdAt: IsoTimestamp('2026-05-09T11:56:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-09T11:56:00.000Z'),
  };
}

function ans(over: Partial<SavedAnswer> = {}): SavedAnswer {
  return {
    id: SavedAnswerId('a1'),
    bookId: BookId('book-1'),
    threadId: ChatThreadId('t1'),
    messageId: ChatMessageId('m1'),
    modelId: 'gpt-x',
    mode: 'passage',
    content: 'The answer text.',
    question: 'What is the theme?',
    contextRefs: [],
    createdAt: IsoTimestamp('2026-05-09T11:58:00.000Z'),
    ...over,
  };
}

describe('exportNotebookToMarkdown', () => {
  it('returns header + "No entries to export." when entries is empty', () => {
    const md = exportNotebookToMarkdown({
      bookTitle: 'Pride and Prejudice',
      entries: [],
      nowMs: NOW,
    });
    expect(md).toContain('# Pride and Prejudice');
    expect(md).toContain('Exported from Bookworm on 2026-05-09');
    expect(md).toContain('*No entries to export.*');
    expect(md).not.toContain('## Bookmarks');
  });

  it('renders a single bookmark; Highlights + Saved AI answers headings omitted', () => {
    const entries: NotebookEntry[] = [{ kind: 'bookmark', bookmark: bm() }];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Pride and Prejudice',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('## Bookmarks');
    expect(md).toContain('**Chapter 1**');
    expect(md).toContain('A bookmarked passage of text.');
    expect(md).not.toContain('## Highlights');
    expect(md).not.toContain('## Saved AI answers');
  });

  it('renders a highlight without note (no Note line)', () => {
    const entries: NotebookEntry[] = [{ kind: 'highlight', highlight: hl(), note: null }];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('## Highlights');
    expect(md).toContain('### Chapter 2');
    expect(md).toContain('> A piece of selected text');
    expect(md).toContain('*yellow*');
    expect(md).not.toContain('**Note:**');
  });

  it('renders a highlight WITH note (Note line inside its own blockquote)', () => {
    const h = hl();
    const entries: NotebookEntry[] = [
      { kind: 'highlight', highlight: h, note: noteFor(h.id, 'A thoughtful note.') },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('> A piece of selected text');
    expect(md).toContain('> **Note:** A thoughtful note.');
  });

  it('renders a saved answer with two contextRefs (passage + section)', () => {
    const entries: NotebookEntry[] = [
      {
        kind: 'savedAnswer',
        savedAnswer: ans({
          contextRefs: [
            {
              kind: 'passage',
              text: 'pass1',
              sectionTitle: 'Ch 1',
              anchor: { kind: 'epub-cfi', cfi: 'x' },
            },
            {
              kind: 'section',
              sectionId: 'sec-ch-2' as never,
              sectionTitle: 'Ch 2',
            },
          ],
        }),
      },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('## Saved AI answers');
    expect(md).toContain('### What is the theme?');
    expect(md).toContain('*passage* · *gpt-x* ·');
    expect(md).toContain('> The answer text.');
    expect(md).toContain('**Sources:**');
    expect(md).toContain('- Ch 1 — *passage*');
    expect(md).toContain('- Ch 2 — *section*');
  });

  it('renders contextRefs of kind highlight or chunk with placeholder titles', () => {
    const entries: NotebookEntry[] = [
      {
        kind: 'savedAnswer',
        savedAnswer: ans({
          contextRefs: [
            { kind: 'highlight', highlightId: HighlightId('h-x') },
            { kind: 'chunk', chunkId: 'c-x' as never },
          ],
        }),
      },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('- (highlight) — *highlight*');
    expect(md).toContain('- (chunk) — *chunk*');
  });

  it('mixed entries: all three sections present in correct order', () => {
    const h = hl();
    const entries: NotebookEntry[] = [
      { kind: 'bookmark', bookmark: bm() },
      { kind: 'highlight', highlight: h, note: null },
      { kind: 'savedAnswer', savedAnswer: ans() },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    const idxBookmarks = md.indexOf('## Bookmarks');
    const idxHighlights = md.indexOf('## Highlights');
    const idxAnswers = md.indexOf('## Saved AI answers');
    expect(idxBookmarks).toBeGreaterThan(0);
    expect(idxHighlights).toBeGreaterThan(idxBookmarks);
    expect(idxAnswers).toBeGreaterThan(idxHighlights);
  });

  it('two consecutive highlights with same sectionTitle dedupe the section heading', () => {
    const h1 = hl({ id: HighlightId('h1'), selectedText: 'first quote' });
    const h2 = hl({ id: HighlightId('h2'), selectedText: 'second quote' });
    const entries: NotebookEntry[] = [
      { kind: 'highlight', highlight: h1, note: null },
      { kind: 'highlight', highlight: h2, note: null },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    const matches = md.match(/^### Chapter 2$/gm);
    expect(matches?.length).toBe(1);
    expect(md).toContain('first quote');
    expect(md).toContain('second quote');
  });

  it('markdown-special chars in selectedText are scoped inside a blockquote', () => {
    const h = hl({ selectedText: '# Should not be a heading\n* not a list' });
    const entries: NotebookEntry[] = [{ kind: 'highlight', highlight: h, note: null }];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('> # Should not be a heading');
    expect(md).toContain('> * not a list');
  });
});

describe('slugifyTitle', () => {
  it('lowercases and replaces non-alphanumerics with dashes', () => {
    expect(slugifyTitle('Pride and Prejudice')).toBe('pride-and-prejudice');
  });

  it('collapses repeated dashes', () => {
    expect(slugifyTitle('A   B')).toBe('a-b');
    expect(slugifyTitle('A: B')).toBe('a-b');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugifyTitle('  Hello!  ')).toBe('hello');
  });

  it('returns "notebook" when slugified result is empty', () => {
    expect(slugifyTitle('')).toBe('notebook');
    expect(slugifyTitle('!!!')).toBe('notebook');
  });

  it('preserves digits', () => {
    expect(slugifyTitle('1984')).toBe('1984');
  });
});
