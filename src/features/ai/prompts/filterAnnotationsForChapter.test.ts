import { describe, expect, it } from 'vitest';
import { filterAnnotationsForChapter } from './filterAnnotationsForChapter';
import {
  BookId,
  HighlightId,
  IsoTimestamp,
  NoteId,
  type Highlight,
  type Note,
} from '@/domain';

function highlight(id: string, sectionTitle: string | null): Highlight {
  return {
    id: HighlightId(id),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: '/' },
    selectedText: 't',
    sectionTitle,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
  };
}

function noteOnHighlight(id: string, highlightId: string, content = 'note'): Note {
  return {
    id: NoteId(id),
    bookId: BookId('b1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId(highlightId) },
    content,
    createdAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
  };
}

function locationNote(id: string, content = 'loc note'): Note {
  return {
    id: NoteId(id),
    bookId: BookId('b1'),
    anchorRef: { kind: 'location', anchor: { kind: 'epub-cfi', cfi: '/' } },
    content,
    createdAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-07T00:00:00.000Z'),
  };
}

describe('filterAnnotationsForChapter', () => {
  it('keeps highlights whose sectionTitle matches the chapter title', () => {
    const highlights = [
      highlight('h1', 'Chapter VII'),
      highlight('h2', 'Chapter VIII'),
      highlight('h3', 'Chapter VII'),
    ];
    const result = filterAnnotationsForChapter(highlights, [], 'Chapter VII');
    expect(result.highlights.map((h) => h.id)).toEqual(['h1', 'h3']);
  });

  it('drops highlights with null sectionTitle', () => {
    const highlights = [highlight('h1', null), highlight('h2', 'Chapter VII')];
    const result = filterAnnotationsForChapter(highlights, [], 'Chapter VII');
    expect(result.highlights.map((h) => h.id)).toEqual(['h2']);
  });

  it('keeps highlight-anchored notes whose highlight is in the chapter', () => {
    const highlights = [highlight('h1', 'Chapter VII'), highlight('h2', 'Chapter VIII')];
    const notes = [
      noteOnHighlight('n1', 'h1'),
      noteOnHighlight('n2', 'h2'),
      noteOnHighlight('n3', 'h1'),
    ];
    const result = filterAnnotationsForChapter(highlights, notes, 'Chapter VII');
    expect(result.notes.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('drops location-anchored notes (out of scope for v1)', () => {
    const highlights = [highlight('h1', 'Chapter VII')];
    const notes = [noteOnHighlight('n1', 'h1'), locationNote('n2')];
    const result = filterAnnotationsForChapter(highlights, notes, 'Chapter VII');
    expect(result.notes.map((n) => n.id)).toEqual(['n1']);
  });

  it('returns empty when no highlights match', () => {
    const highlights = [highlight('h1', 'Chapter VIII')];
    const notes = [noteOnHighlight('n1', 'h1')];
    const result = filterAnnotationsForChapter(highlights, notes, 'Chapter VII');
    expect(result.highlights).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});
