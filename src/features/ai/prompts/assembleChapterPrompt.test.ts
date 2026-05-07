import { describe, expect, it } from 'vitest';
import {
  assembleChapterPrompt,
  CHAPTER_CONTEXT_TOKEN_BUDGET,
  CHAPTER_BUDGET_RESERVE_FOR_PROMPT,
} from './assembleChapterPrompt';
import {
  BookId,
  ChunkId,
  HighlightId,
  IsoTimestamp,
  NoteId,
  SectionId,
  type Highlight,
  type Note,
  type TextChunk,
} from '@/domain';

function chunk(idx: number, tokenEstimate = 50, text = `chunk-${String(idx)} content`): TextChunk {
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('spine:OEBPS/foo.html'),
    sectionTitle: 'Chapter VII',
    text,
    normalizedText: text,
    tokenEstimate,
    locationAnchor: { kind: 'epub-cfi', cfi: '/' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

function highlight(id: string, text: string): Highlight {
  return {
    id: HighlightId(id),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: '/' },
    selectedText: text,
    sectionTitle: 'Chapter VII',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
  };
}

function noteOn(id: string, highlightId: string, content: string): Note {
  return {
    id: NoteId(id),
    bookId: BookId('b1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId(highlightId) },
    content,
    createdAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
  };
}

const baseBook = { title: 'Pride and Prejudice', author: 'Jane Austen' };

describe('assembleChapterPrompt', () => {
  it('returns [system, user] message pair', () => {
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks: [chunk(0)],
      highlights: [],
      notes: [],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('user message contains the chapter title and book title', () => {
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks: [chunk(0)],
      highlights: [],
      notes: [],
    });
    const body = messages[1]?.content ?? '';
    expect(body).toContain('Chapter VII');
    expect(body).toContain('Pride and Prejudice');
  });

  it('all chunks included when total tokens are under budget', () => {
    const chunks = [chunk(0, 50, 'first'), chunk(1, 50, 'second'), chunk(2, 50, 'third')];
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks,
      highlights: [],
      notes: [],
    });
    const body = messages[1]?.content ?? '';
    expect(body).toContain('first');
    expect(body).toContain('second');
    expect(body).toContain('third');
  });

  it('chunks sampled (count reduced) when total tokens exceed budget', () => {
    const chunks = Array.from({ length: 200 }, (_, i) => chunk(i, 100, `text-${String(i)}`));
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks,
      highlights: [],
      notes: [],
    });
    const body = messages[1]?.content ?? '';
    const includedCount = chunks.filter((c) => body.includes(c.text)).length;
    expect(includedCount).toBeLessThan(chunks.length);
    expect(includedCount).toBeGreaterThan(0);
  });

  it('highlights included with their selected text', () => {
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks: [chunk(0)],
      highlights: [highlight('h1', 'memorable line')],
      notes: [],
    });
    const body = messages[1]?.content ?? '';
    expect(body).toContain('memorable line');
  });

  it('notes included with their content', () => {
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks: [chunk(0)],
      highlights: [highlight('h1', 'flagged')],
      notes: [noteOn('n1', 'h1', 'this matters because of foo')],
    });
    const body = messages[1]?.content ?? '';
    expect(body).toContain('this matters because of foo');
  });

  it('renders absent annotations gracefully', () => {
    const messages = assembleChapterPrompt({
      book: baseBook,
      sectionTitle: 'Chapter VII',
      chunks: [chunk(0)],
      highlights: [],
      notes: [],
    });
    const body = messages[1]?.content ?? '';
    expect(body).not.toContain('[object Object]');
    expect(body.length).toBeGreaterThan(0);
  });

  it('exports the budget constant for callers', () => {
    expect(CHAPTER_CONTEXT_TOKEN_BUDGET).toBe(6500);
    expect(CHAPTER_BUDGET_RESERVE_FOR_PROMPT).toBeGreaterThan(0);
    expect(CHAPTER_BUDGET_RESERVE_FOR_PROMPT).toBeLessThan(CHAPTER_CONTEXT_TOKEN_BUDGET);
  });
});
