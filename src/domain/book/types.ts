import type { BookId, ChunkId, IsoTimestamp, SectionId } from '../ids';
import type { LocationAnchor } from '../locations';
import type { ImportStatus, SourceRef } from '../import/types';
import type { AIProfileStatus, IndexingStatus } from '../indexing/types';

export type BookFormat = 'epub' | 'pdf';

export type CoverRef =
  | { readonly kind: 'opfs'; readonly path: string }
  | { readonly kind: 'inline'; readonly dataUrl: string }
  | { readonly kind: 'none' };

export type TocEntry = {
  readonly id: SectionId;
  readonly title: string;
  readonly anchor: LocationAnchor;
  readonly depth: number;
};

export type ReadingProgress = {
  readonly anchor: LocationAnchor;
  readonly percent: number;
  readonly updatedAt: IsoTimestamp;
};

export type Book = {
  readonly id: BookId;
  readonly title: string;
  readonly subtitle?: string;
  readonly author?: string;
  readonly format: BookFormat;
  readonly description?: string;
  readonly coverRef: CoverRef;
  readonly toc: readonly TocEntry[];
  readonly progress?: ReadingProgress;
  readonly source: SourceRef;
  readonly importStatus: ImportStatus;
  readonly indexingStatus: IndexingStatus;
  readonly aiProfileStatus: AIProfileStatus;
  readonly lastOpenedAt?: IsoTimestamp; // undefined = never opened
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};

export type BookSection = {
  readonly id: SectionId;
  readonly bookId: BookId;
  readonly title: string;
  readonly order: number;
  readonly locationStart: LocationAnchor;
  readonly locationEnd: LocationAnchor;
  readonly previewText: string;
};

export type TextChunk = {
  readonly id: ChunkId;
  readonly bookId: BookId;
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly text: string;
  readonly normalizedText: string;
  readonly tokenEstimate: number;
  readonly locationAnchor: LocationAnchor;
  readonly checksum: string;
  readonly chunkerVersion: number;
};

// id mirrors the chunk's id so the two stores stay 1:1; chunkerVersion +
// embeddingModelVersion let us invalidate independently (chunker bump →
// chunks rebuild → embeddings cascade-invalidate; model bump → embeddings
// drop, chunks untouched).
export type BookEmbedding = {
  readonly id: ChunkId;
  readonly bookId: BookId;
  readonly vector: Float32Array;
  readonly chunkerVersion: number;
  readonly embeddingModelVersion: number;
  readonly embeddedAt: IsoTimestamp;
};

export type BookStructure = 'fiction' | 'nonfiction' | 'textbook' | 'reference';

// 2-4 sentence summary, genre, structure-tag, themes (typically 3-8 strings),
// and keyEntities split into characters / concepts / places. characters can
// be empty for non-fiction.
export type BookProfile = {
  readonly summary: string;
  readonly genre: string;
  readonly structure: BookStructure;
  readonly themes: readonly string[];
  readonly keyEntities: {
    readonly characters: readonly string[];
    readonly concepts: readonly string[];
    readonly places: readonly string[];
  };
};

export type SuggestedPromptCategory =
  | 'comprehension'
  | 'analysis'
  | 'structure'
  | 'creative'
  | 'study';

export type SuggestedPrompt = {
  readonly text: string;
  readonly category: SuggestedPromptCategory;
};

// Per-book record persisted in book_profiles IDB store. profileSchemaVersion
// enables future-phase migration; v1 ships at 1 with no app-open scan.
export type BookProfileRecord = {
  readonly bookId: BookId;
  readonly profile: BookProfile;
  readonly prompts: readonly SuggestedPrompt[];
  readonly profileSchemaVersion: number;
  readonly generatedAt: IsoTimestamp;
};
