import type { TextChunk, TocEntry } from '@/domain';
import type { ChatCompletionMessage } from '@/features/ai/chat/nanogptChat';

export const BOOK_PROFILE_SYSTEM_PROMPT = [
  'You are suggesting beginner-friendly starter questions for a reader who has just opened this book.',
  '',
  'Return a JSON object with two top-level fields:',
  '`profile` containing summary (2-4 sentences), genre, structure, themes (3-8),',
  'and keyEntities (characters, concepts, places).',
  '`prompts` containing 4-8 suggested questions a curious reader might ask early on.',
  '',
  'PROMPT STYLE: simple, conversational, gateway questions — not literary analysis.',
  'Aim for the level of a friend asking what they are getting into,',
  'not a graduate seminar. A high-schooler should be able to ask any of these naturally.',
  '',
  'Good examples:',
  '- "What is this book about?"',
  '- "Who are the main characters?"',
  '- "Where and when does this take place?"',
  '- "What kind of book is this?"',
  '- "What are the major themes?"',
  '- "Who is [a key character]?"  (use a specific entity from the book)',
  '- "What is the family tree of [main family]?"  (only if the book has a real family)',
  '',
  'Avoid:',
  '- Multi-clause questions referencing specific chapters or scenes',
  '- Literary jargon: "arc", "motive", "structure", "contrast", "paired", "trace"',
  '- Comparative analysis between events ("How does X shift from A to B?")',
  '- Anything that assumes the reader has already finished the book',
  '',
  'Most prompts should be plainly general; 1-2 may lightly reference a specific entity',
  '(a character, place, or concept) to make them feel grounded. Tag each prompt',
  'with one of: comprehension, analysis, structure, creative, study.',
  'Lean heavily toward `comprehension` — that is the gateway category that fits',
  'simple starter questions. Use the others only when a question genuinely calls for it.',
].join(' ');

function renderToc(toc: readonly TocEntry[]): string {
  if (toc.length === 0) return '(none)';
  return toc
    .map((entry) => `${'  '.repeat(entry.depth)}- ${entry.title}`)
    .join('\n');
}

function renderExcerpts(chunks: readonly TextChunk[]): string {
  if (chunks.length === 0) return '(no excerpts available)';
  return chunks
    .map((c) => `[Section: ${c.sectionTitle}]\n${c.text}`)
    .join('\n\n');
}

export function assembleProfilePrompt(
  book: { readonly title: string; readonly author?: string; readonly toc: readonly TocEntry[] },
  sampledChunks: readonly TextChunk[],
): readonly ChatCompletionMessage[] {
  const author = book.author ?? 'Unknown';
  const userContent = [
    `Title: ${book.title}`,
    `Author: ${author}`,
    '',
    'Table of contents:',
    renderToc(book.toc),
    '',
    'Sampled excerpts (one per representative section):',
    '',
    renderExcerpts(sampledChunks),
  ].join('\n');

  return [
    { role: 'system', content: BOOK_PROFILE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
