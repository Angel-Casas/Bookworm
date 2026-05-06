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
