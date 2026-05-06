import type { BookFormat, ChatMessage } from '@/domain';
import type { ChatCompletionMessage } from './nanogptChat';
import {
  buildEvidenceBundleForPreview,
  type EvidenceBundle,
} from '@/features/ai/retrieval/evidenceBundle';

// Soft caps on how many user/assistant pairs of prior history we ship to the
// model. Passage-mode threads carry up to ~5KB of selection + windows per
// message, so we trim more aggressively when any message in the thread (or
// the new turn) is passage-mode. Retrieval is even larger (an evidence
// bundle of up to ~3000 tokens), so retrieval mode trims most aggressively.
export const HISTORY_SOFT_CAP_OPEN = 40;
export const HISTORY_SOFT_CAP_PASSAGE = 30;
export const HISTORY_SOFT_CAP_RETRIEVAL = 25;
// Backward alias — kept so existing imports of HISTORY_SOFT_CAP continue to
// reflect the open-mode default.
export const HISTORY_SOFT_CAP = HISTORY_SOFT_CAP_OPEN;

const SELECTION_CHAR_CAP = 4000;

const PASSAGE_MODE_ADDENDUM =
  "The user has attached a passage from this book. Treat the bolded text " +
  "between the ellipsis windows as the primary subject. The surrounding " +
  "ellipsis text is included only for orientation — do not summarize or " +
  "analyze it as if it were the user's selection. If the user asks for " +
  'something that requires text outside the attached window, say so and ' +
  'offer to help once they share more.';

const RETRIEVAL_MODE_ADDENDUM =
  'The user has searched this book for relevant excerpts; they are ' +
  'numbered [1], [2], … below. Treat these as the primary evidence. ' +
  'Reference them by tag in your answer when you draw on a specific ' +
  'excerpt (e.g. "as discussed in [3]"). If the excerpts do not contain ' +
  'enough to answer, say so plainly and offer to help once they share more ' +
  'context. Do not invent excerpts that are not present.';

export function buildOpenModeSystemPrompt(book: {
  readonly title: string;
  readonly author?: string;
}): string {
  const subject = book.author
    ? `the book "${book.title}" by ${book.author}`
    : `the book "${book.title}"`;
  return [
    `You are helping a reader discuss ${subject}.`,
    `The user has not selected any passages or chapters; you have only the book's title${book.author ? ' and author' : ''}.`,
    `Answer carefully. When discussing book contents, distinguish between what the title strongly implies and what you actually have evidence for.`,
    `If the user asks about specifics, say plainly that no excerpts are attached and offer to help once they share a passage.`,
    `Do not pretend to have read the book.`,
  ].join(' ');
}

export type AssembleOpenChatInput = {
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
  };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
};

export type AssemblePassageChatInput = {
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
  };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
  readonly passage: {
    readonly text: string;
    readonly windowBefore?: string;
    readonly windowAfter?: string;
    readonly sectionTitle?: string;
  };
};

export type AssembleRetrievalChatInput = {
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
  };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
  readonly bundle: EvidenceBundle;
};

export type AssembleOpenChatResult = {
  readonly messages: readonly ChatCompletionMessage[];
  readonly historyDropped: number;
};

function effectiveSoftCap(
  history: readonly ChatMessage[],
  thisMode: 'open' | 'passage' | 'retrieval',
): number {
  if (thisMode === 'retrieval' || history.some((m) => m.mode === 'retrieval')) {
    return HISTORY_SOFT_CAP_RETRIEVAL;
  }
  if (thisMode === 'passage' || history.some((m) => m.mode === 'passage')) {
    return HISTORY_SOFT_CAP_PASSAGE;
  }
  return HISTORY_SOFT_CAP_OPEN;
}

function preserveHistory(
  history: readonly ChatMessage[],
  cap: number,
): { preserved: readonly ChatMessage[]; dropFromFront: number } {
  const preservedCount = cap * 2;
  const dropFromFront = Math.max(0, history.length - preservedCount);
  return { preserved: history.slice(dropFromFront), dropFromFront };
}

function historyToCompletionMessages(
  preserved: readonly ChatMessage[],
): ChatCompletionMessage[] {
  return preserved
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

export function assembleOpenChatPrompt(input: AssembleOpenChatInput): AssembleOpenChatResult {
  const system: ChatCompletionMessage = {
    role: 'system',
    content: buildOpenModeSystemPrompt(input.book),
  };

  const cap = effectiveSoftCap(input.history, 'open');
  const { preserved, dropFromFront } = preserveHistory(input.history, cap);
  const historyMsgs = historyToCompletionMessages(preserved);
  const tail: ChatCompletionMessage = { role: 'user', content: input.newUserText };

  return {
    messages: [system, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}

// Build the passage block prepended to the new user message. Exported so
// PrivacyPreview can render character-for-character what gets sent.
export function buildPassageBlockForPreview(
  bookTitle: string,
  passage: AssemblePassageChatInput['passage'],
): string {
  const titleLine =
    passage.sectionTitle !== undefined
      ? `[Passage from "${bookTitle}" — ${passage.sectionTitle}]`
      : `[Passage from "${bookTitle}"]`;

  const truncated = passage.text.length > SELECTION_CHAR_CAP;
  const cappedText = truncated
    ? passage.text.slice(0, SELECTION_CHAR_CAP)
    : passage.text;
  const truncationNotice = truncated ? '\n(truncated for AI)' : '';

  const before =
    passage.windowBefore !== undefined ? `…${passage.windowBefore}\n` : '';
  const after =
    passage.windowAfter !== undefined ? `\n${passage.windowAfter}…` : '';

  return `${titleLine}\n${before}**${cappedText}**${truncationNotice}${after}`;
}

export function assemblePassageChatPrompt(
  input: AssemblePassageChatInput,
): AssembleOpenChatResult {
  const combinedSystem: ChatCompletionMessage = {
    role: 'system',
    content: `${buildOpenModeSystemPrompt(input.book)}\n\n${PASSAGE_MODE_ADDENDUM}`,
  };

  const cap = effectiveSoftCap(input.history, 'passage');
  const { preserved, dropFromFront } = preserveHistory(input.history, cap);
  const historyMsgs = historyToCompletionMessages(preserved);

  const passageBlock = buildPassageBlockForPreview(input.book.title, input.passage);
  const tail: ChatCompletionMessage = {
    role: 'user',
    content: `${passageBlock}\n\n${input.newUserText}`,
  };

  return {
    messages: [combinedSystem, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}

export function assembleRetrievalChatPrompt(
  input: AssembleRetrievalChatInput,
): AssembleOpenChatResult {
  const combinedSystem: ChatCompletionMessage = {
    role: 'system',
    content: `${buildOpenModeSystemPrompt(input.book)}\n\n${RETRIEVAL_MODE_ADDENDUM}`,
  };

  const cap = effectiveSoftCap(input.history, 'retrieval');
  const { preserved, dropFromFront } = preserveHistory(input.history, cap);
  const historyMsgs = historyToCompletionMessages(preserved);

  const bundleText = buildEvidenceBundleForPreview(input.bundle);
  const tail: ChatCompletionMessage = {
    role: 'user',
    content: `${bundleText}\n\n${input.newUserText}`,
  };

  return {
    messages: [combinedSystem, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}
