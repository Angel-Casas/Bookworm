import type { Highlight, Note, TextChunk } from '@/domain';
import type { ChatCompletionMessage } from '@/features/ai/chat/nanogptChat';

// Internal budget for chapter-mode requests. Chosen consistent with
// EMBED_TOKEN_BUDGET (Phase 5.2 hardening): our internal tokenEstimate
// over-counts vs. server tokenizers by ~25-30%, so 6500 internal ≈
// 4800-5000 server-counted, leaving comfortable headroom under 8K-window
// models and trivial under 32K+.
export const CHAPTER_CONTEXT_TOKEN_BUDGET = 6500;

// Reserved tokens for the system prompt + structural framing in the user
// message (chapter title header, "highlights:" labels, etc.). The system
// prompt is small (~150 tokens); pad to 400 for safety. tokenEstimate of
// the actual rendered messages is not computed precisely — over-estimating
// here just means the chunk loop has slightly less room.
export const CHAPTER_BUDGET_RESERVE_FOR_PROMPT = 400;

const SYSTEM_PROMPT = [
  'You are answering a question about a specific chapter of a book.',
  'The user has attached the chapter contents below — chunks of text from',
  'the chapter, plus any highlights and notes the reader has made within',
  'this chapter.',
  '',
  'Ground your answer in the attached chapter content. If the question',
  'asks for something not covered by the attached content, say so plainly',
  'rather than inventing details from outside this chapter.',
  '',
  'Keep the answer focused on the chapter at hand. Cross-references to',
  'other chapters are fine when the user asks for them, but the default',
  'is to stay grounded in the attached material.',
].join('\n');

function tokenEstimate(text: string): number {
  // Approximate: 1 token ≈ 4 chars. Same heuristic as paragraphsToChunks.
  return Math.ceil(text.length / 4);
}

function renderHighlight(h: Highlight, idx: number): string {
  return `[Highlight ${String(idx + 1)}] ${h.selectedText}`;
}

function renderNote(n: Note, idx: number): string {
  return `[Note ${String(idx + 1)}] ${n.content}`;
}

function renderChunk(c: TextChunk): string {
  return c.text;
}

/**
 * Even-stride samples a list down to a target count while preserving
 * document order. If `targetCount >= input.length`, returns input unchanged.
 */
function sampleEvenStride<T>(items: readonly T[], targetCount: number): readonly T[] {
  if (targetCount >= items.length) return items;
  if (targetCount <= 0) return [];
  const stride = Math.ceil(items.length / targetCount);
  const out: T[] = [];
  for (let i = 0; i < items.length && out.length < targetCount; i += stride) {
    const item = items[i];
    if (item !== undefined) out.push(item);
  }
  return out;
}

export type AssembleChapterPromptInput = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly sectionTitle: string;
  readonly chunks: readonly TextChunk[];
  readonly highlights: readonly Highlight[];
  readonly notes: readonly Note[];
};

export function assembleChapterPrompt(
  input: AssembleChapterPromptInput,
): readonly ChatCompletionMessage[] {
  const { book, sectionTitle, chunks, highlights, notes } = input;

  const highlightLines = highlights.map(renderHighlight);
  const noteLines = notes.map(renderNote);
  const annotationsBlock =
    highlightLines.length === 0 && noteLines.length === 0
      ? '(no highlights or notes in this chapter)'
      : [
          highlightLines.length > 0 ? `Highlights:\n${highlightLines.join('\n')}` : '',
          noteLines.length > 0 ? `Notes:\n${noteLines.join('\n')}` : '',
        ]
          .filter((s) => s.length > 0)
          .join('\n\n');

  const annotationsTokens = tokenEstimate(annotationsBlock);
  const chunkBudget = Math.max(
    0,
    CHAPTER_CONTEXT_TOKEN_BUDGET -
      CHAPTER_BUDGET_RESERVE_FOR_PROMPT -
      annotationsTokens,
  );

  const totalChunkTokens = chunks.reduce((acc, c) => acc + c.tokenEstimate, 0);
  const sampledChunks =
    totalChunkTokens <= chunkBudget
      ? chunks
      : sampleEvenStride(
          chunks,
          Math.max(
            1,
            Math.floor(chunkBudget / Math.max(1, totalChunkTokens / chunks.length)),
          ),
        );

  const chunkBlock =
    sampledChunks.length === 0
      ? '(no chunks available)'
      : sampledChunks.map(renderChunk).join('\n\n---\n\n');

  const userContent = [
    `Book: ${book.title}${book.author ? ` — ${book.author}` : ''}`,
    `Chapter: ${sectionTitle}`,
    '',
    'Chapter content:',
    chunkBlock,
    '',
    annotationsBlock,
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
