import { describe, expect, it } from 'vitest';
import { assembleProfilePrompt, BOOK_PROFILE_SYSTEM_PROMPT } from './assembleProfilePrompt';
import {
  BookId,
  ChunkId,
  SectionId,
  type TextChunk,
  type TocEntry,
} from '@/domain';

function chunk(sectionId: string, sectionTitle: string, text: string): TextChunk {
  return {
    id: ChunkId(`chunk-b1-${sectionId}-0`),
    bookId: BookId('b1'),
    sectionId: SectionId(sectionId),
    sectionTitle,
    text,
    normalizedText: text,
    tokenEstimate: 5,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

const tocEntry = (id: string, title: string, depth: number): TocEntry => ({
  id: SectionId(id),
  title,
  anchor: { kind: 'epub-cfi', cfi: `/6/${id}` },
  depth,
});

describe('assembleProfilePrompt', () => {
  it('returns [system, user] message pair', () => {
    const messages = assembleProfilePrompt(
      { title: 'Pride and Prejudice', author: 'Austen', toc: [] },
      [],
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('system prompt mentions schema and categories', () => {
    expect(BOOK_PROFILE_SYSTEM_PROMPT).toMatch(/JSON/);
    expect(BOOK_PROFILE_SYSTEM_PROMPT).toMatch(/comprehension/);
  });

  it('system prompt biases toward beginner-friendly starter questions, not deep analysis', () => {
    // Regression: the original prompt instructed the LLM to "Avoid generic
    // prompts like 'What is this book about?'", which produced multi-clause
    // analytical questions that overwhelmed first-time readers. The product
    // intent is exactly the opposite — generic gateway questions are good.
    const lower = BOOK_PROFILE_SYSTEM_PROMPT.toLowerCase();
    // Positive signals: the prompt should explicitly bless gateway questions.
    expect(lower).toMatch(/beginner|starter|gateway|simple/);
    expect(BOOK_PROFILE_SYSTEM_PROMPT).toContain('What is this book about?');
    // Negative signals: the prompt should not still be steering toward
    // graduate-seminar-style framings.
    expect(lower).not.toMatch(/relationship-arc/);
    expect(lower).not.toMatch(/motive-tracking/);
    expect(lower).not.toMatch(/claim-mapping/);
  });

  it('user message contains title, author, and TOC', () => {
    const messages = assembleProfilePrompt(
      {
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
        toc: [tocEntry('s1', 'Chapter One', 0), tocEntry('s2', 'Chapter Two', 0)],
      },
      [],
    );
    const body = messages[1]?.content ?? '';
    expect(body).toContain('Pride and Prejudice');
    expect(body).toContain('Jane Austen');
    expect(body).toContain('Chapter One');
    expect(body).toContain('Chapter Two');
  });

  it('user message contains sampled excerpts with section headers', () => {
    const messages = assembleProfilePrompt(
      { title: 'B', toc: [] },
      [chunk('s1', 'Ch 1', 'Lorem ipsum.'), chunk('s2', 'Ch 2', 'Dolor sit amet.')],
    );
    const body = messages[1]?.content ?? '';
    expect(body).toContain('Ch 1');
    expect(body).toContain('Lorem ipsum.');
    expect(body).toContain('Ch 2');
    expect(body).toContain('Dolor sit amet.');
  });

  it('TOC depth indents nested entries', () => {
    const messages = assembleProfilePrompt(
      {
        title: 'B',
        toc: [tocEntry('s1', 'Part One', 0), tocEntry('s1.1', 'Sub', 1)],
      },
      [],
    );
    const body = messages[1]?.content ?? '';
    // Depth-1 entry should be indented (some whitespace before the bullet/title).
    expect(body).toMatch(/^\s+.*Sub/m);
  });

  it('renders "(none)" for empty TOC', () => {
    const messages = assembleProfilePrompt({ title: 'B', toc: [] }, []);
    expect(messages[1]?.content).toContain('(none)');
  });

  it('renders Author: Unknown when author is absent', () => {
    const messages = assembleProfilePrompt({ title: 'B', toc: [] }, []);
    expect(messages[1]?.content).toContain('Unknown');
  });
});
