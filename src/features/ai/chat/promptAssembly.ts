import type { BookFormat, ChatMessage } from '@/domain';
import type { ChatCompletionMessage } from './nanogptChat';

export const HISTORY_SOFT_CAP = 40;

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

export type AssembleOpenChatResult = {
  readonly messages: readonly ChatCompletionMessage[];
  readonly historyDropped: number;
};

export function assembleOpenChatPrompt(input: AssembleOpenChatInput): AssembleOpenChatResult {
  const system: ChatCompletionMessage = {
    role: 'system',
    content: buildOpenModeSystemPrompt(input.book),
  };

  const preservedCount = HISTORY_SOFT_CAP * 2;
  const dropFromFront = Math.max(0, input.history.length - preservedCount);
  const preserved = input.history.slice(dropFromFront);

  const historyMsgs: ChatCompletionMessage[] = preserved
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const tail: ChatCompletionMessage = { role: 'user', content: input.newUserText };

  return {
    messages: [system, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}
