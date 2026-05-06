import type { Book } from '@/domain';
import type { SectionId } from '@/domain';
import type { ExtractedParagraph } from './paragraphsToChunks';

export type SectionListing = {
  readonly id: SectionId;
  readonly title: string;
  readonly range: EpubSectionRange | PdfSectionRange;
};

export type EpubSectionRange = {
  readonly kind: 'epub';
  readonly spineIndex: number;
};

export type PdfSectionRange = {
  readonly kind: 'pdf';
  readonly startPage: number;
  readonly endPage: number;
};

// The pipeline calls these two methods; the extractor is the only place that
// knows about format internals. Format-specific extractors implement this
// interface; the pipeline dispatches via book.format.
export interface ChunkExtractor {
  listSections(book: Book): Promise<readonly SectionListing[]>;
  streamParagraphs(
    book: Book,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph>;
}

// Re-export ExtractedParagraph so consumers can import everything from one place.
export type { ExtractedParagraph };
