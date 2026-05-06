import type { TextChunk, TocEntry } from '@/domain';
import type { ChatCompletionMessage } from '@/features/ai/chat/nanogptChat';

export const BOOK_PROFILE_SYSTEM_PROMPT = [
  'You are characterizing a book to help a reader explore it.',
  'Return a JSON object with two top-level fields:',
  '`profile` containing summary (2-4 sentences), genre, structure, themes (3-8), and',
  'keyEntities (characters, concepts, places).',
  '`prompts` containing 4-8 suggested questions the reader might ask.',
  'Each prompt MUST reference something specific from the book: an entity, a theme,',
  'or a chapter title. Avoid generic prompts like "What is this book about?".',
  'Each prompt must be category-tagged with one of:',
  'comprehension, analysis, structure, creative, study.',
  'Distribute prompts across at least 3 of the 5 categories.',
  'If the book is fiction, include relationship-arc and motive-tracking prompts.',
  'If non-fiction, include claim-mapping and key-term prompts.',
  'If textbook, include prerequisite-map and exam-style prompts.',
  'If keyEntities is sparse (poetry, anthology), lean on themes for grounding.',
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
