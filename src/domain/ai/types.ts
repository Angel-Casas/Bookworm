import type {
  AIProfileId,
  BookId,
  ChatMessageId,
  ChatThreadId,
  ChunkId,
  HighlightId,
  IsoTimestamp,
  PromptSetId,
  SectionId,
} from '../ids';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMode = 'passage' | 'chapter' | 'multi-excerpt' | 'retrieval' | 'full-book';

export type AnswerStyle = 'strict-grounded' | 'grounded-plus' | 'open';

// Pointer to evidence the model was given. Stored on a message so a chat
// answer can be linked back to source passages even after the user navigates
// away from the originating selection.
export type ContextRef =
  | { readonly kind: 'passage'; readonly text: string; readonly chunkId?: ChunkId }
  | { readonly kind: 'highlight'; readonly highlightId: HighlightId }
  | { readonly kind: 'chunk'; readonly chunkId: ChunkId }
  | { readonly kind: 'section'; readonly sectionId: SectionId };

export type TokenUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens?: number;
};

export type ChatThread = {
  readonly id: ChatThreadId;
  readonly bookId: BookId;
  readonly title: string;
  readonly modelId: string;
  readonly mode: ChatMode;
  readonly answerStyle: AnswerStyle;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};

export type ChatMessage = {
  readonly id: ChatMessageId;
  readonly threadId: ChatThreadId;
  readonly role: ChatRole;
  readonly content: string;
  readonly contextRefs: readonly ContextRef[];
  readonly usage?: TokenUsage;
  readonly createdAt: IsoTimestamp;
};

export type PromptCategory = 'comprehension' | 'analysis' | 'structure' | 'creative' | 'study';

export type PromptSuggestion = {
  readonly category: PromptCategory;
  readonly text: string;
  readonly rationale?: string;
};

export type PromptSuggestionSet = {
  readonly id: PromptSetId;
  readonly bookId: BookId;
  readonly version: number;
  readonly prompts: readonly PromptSuggestion[];
  readonly createdAt: IsoTimestamp;
};

export type AIProfile = {
  readonly id: AIProfileId;
  readonly bookId: BookId;
  readonly summaryShort: string;
  readonly summaryLong: string;
  readonly themes: readonly string[];
  readonly entities: readonly string[];
  readonly concepts: readonly string[];
  readonly genreGuess?: string;
  readonly difficulty?: 'introductory' | 'intermediate' | 'advanced';
  readonly createdAt: IsoTimestamp;
};
