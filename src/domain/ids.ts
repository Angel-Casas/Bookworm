declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type BookId = Brand<string, 'BookId'>;
export type SectionId = Brand<string, 'SectionId'>;
export type ChunkId = Brand<string, 'ChunkId'>;
export type BookmarkId = Brand<string, 'BookmarkId'>;
export type HighlightId = Brand<string, 'HighlightId'>;
export type NoteId = Brand<string, 'NoteId'>;
export type ChatThreadId = Brand<string, 'ChatThreadId'>;
export type ChatMessageId = Brand<string, 'ChatMessageId'>;
export type PromptSetId = Brand<string, 'PromptSetId'>;
export type AIProfileId = Brand<string, 'AIProfileId'>;

export const BookId = (s: string): BookId => s as BookId;
export const SectionId = (s: string): SectionId => s as SectionId;
export const ChunkId = (s: string): ChunkId => s as ChunkId;
export const BookmarkId = (s: string): BookmarkId => s as BookmarkId;
export const HighlightId = (s: string): HighlightId => s as HighlightId;
export const NoteId = (s: string): NoteId => s as NoteId;
export const ChatThreadId = (s: string): ChatThreadId => s as ChatThreadId;
export const ChatMessageId = (s: string): ChatMessageId => s as ChatMessageId;
export const PromptSetId = (s: string): PromptSetId => s as PromptSetId;
export const AIProfileId = (s: string): AIProfileId => s as AIProfileId;

export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;
export const IsoTimestamp = (s: string): IsoTimestamp => s as IsoTimestamp;
