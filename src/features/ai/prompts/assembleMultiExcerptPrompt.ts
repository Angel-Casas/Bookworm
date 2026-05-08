import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import type { ChatCompletionMessage } from '@/features/ai/chat/nanogptChat';

export const MULTI_EXCERPT_TOTAL_BUDGET = 5000;
export const PER_EXCERPT_SOFT_CAP_TOKENS = 800;
export const PER_EXCERPT_FLOOR_TOKENS = 200;
const TRUNCATION_MARKER = '\n\n(truncated for AI)';

function systemPrompt(title: string, author?: string): string {
  return [
    `You are reading "${title}"${author !== undefined ? ` by ${author}` : ''}. The user has selected several`,
    'excerpts from this book and wants you to compare or relate them.',
    '',
    'GROUNDING RULES:',
    '- Treat the provided excerpts as the primary source of truth.',
    '- When you cite something, refer to it by its excerpt label (e.g.',
    '  "Excerpt 2") so the user can match your answer to the source.',
    '- If the excerpts don\'t contain enough evidence to answer, say so',
    '  plainly. Do not invent facts about the book outside what\'s',
    '  provided.',
    '- Distinguish clearly between what the excerpts state and any outside',
    '  knowledge you bring in. Label outside knowledge as such.',
  ].join('\n');
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_MARKER;
}

function renderExcerpt(label: string, sectionTitle: string, body: string): string {
  return `${label} — ${sectionTitle}\n"""\n${body}\n"""`;
}

export type AssembleMultiExcerptPromptInput = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly excerpts: readonly AttachedExcerpt[];
};

export function assembleMultiExcerptPrompt(
  input: AssembleMultiExcerptPromptInput,
): readonly ChatCompletionMessage[] {
  const { book, excerpts } = input;

  // Stage 1: per-excerpt soft-cap truncation.
  const softCapped = excerpts.map((e) => truncateToTokens(e.text, PER_EXCERPT_SOFT_CAP_TOKENS));

  // Stage 2: total-budget proportional trim with floor enforcement.
  const totalTokens = softCapped.reduce((acc, t) => acc + tokenEstimate(t), 0);
  const finalBodies =
    totalTokens <= MULTI_EXCERPT_TOTAL_BUDGET
      ? softCapped
      : softCapped.map((t) => {
          const tokens = tokenEstimate(t);
          const targetTokens = Math.max(
            PER_EXCERPT_FLOOR_TOKENS,
            Math.floor((tokens * MULTI_EXCERPT_TOTAL_BUDGET) / totalTokens),
          );
          return truncateToTokens(t, targetTokens);
        });

  const renderedExcerpts = excerpts.map((e, i) =>
    renderExcerpt(`Excerpt ${String(i + 1)}`, e.sectionTitle, finalBodies[i] ?? ''),
  );

  const userContent = [
    `Compare or relate the following excerpts from "${book.title}".`,
    '',
    renderedExcerpts.join('\n\n'),
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt(book.title, book.author) },
    { role: 'user', content: userContent },
  ];
}
