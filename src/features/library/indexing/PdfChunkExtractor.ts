import type { Book, LocationAnchor } from '@/domain';
import { SectionId } from '@/domain';
import type {
  ChunkExtractor,
  SectionListing,
  ExtractedParagraph,
} from './extractor';
import {
  groupItemsIntoLines,
  groupLinesIntoParagraphs,
  dehyphenateWordWraps,
  detectRunningHeadersFooters,
  isPageNumberOnly,
  type PdfItem,
} from './pdfHelpers';
import { pdfjs } from '@/features/library/import/parsers/pdf-pdfjs';

type ResolveBlob = (book: Book) => Promise<Blob>;

// Minimal subset of pdfjs's PDFDocumentProxy we use. Lets us mock in tests.
type PdfDocLike = {
  numPages: number;
  getOutline(): Promise<readonly OutlineNode[] | null>;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getPageIndex?(dest: unknown): Promise<number>;
};

type OutlineNode = {
  readonly title: string;
  readonly dest?: unknown;
  readonly items?: readonly OutlineNode[];
};

type PdfPageLike = {
  getTextContent(): Promise<{ items: PdfItem[] }>;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export class PdfChunkExtractor implements ChunkExtractor {
  constructor(private readonly resolveBlob?: ResolveBlob) {}

  async listSections(book: Book): Promise<readonly SectionListing[]> {
    if (book.format !== 'pdf') {
      throw new Error(`PdfChunkExtractor: cannot list sections for ${book.format}`);
    }
    if (this.resolveBlob === undefined) {
      throw new Error('PdfChunkExtractor: no blob resolver configured');
    }
    const blob = await this.resolveBlob(book);
    const arrayBuffer = await blob.arrayBuffer();
    const pdfDoc = (await pdfjs.getDocument({ data: arrayBuffer }).promise) as unknown as PdfDocLike;
    return this.listSectionsFromPdfDoc(pdfDoc, book.title);
  }

  async listSectionsFromPdfDoc(
    pdfDoc: PdfDocLike,
    bookTitle: string,
  ): Promise<readonly SectionListing[]> {
    const outline = await pdfDoc.getOutline();
    if (outline === null || outline.length === 0) {
      return [
        {
          id: SectionId('__whole_book__'),
          title: bookTitle,
          range: { kind: 'pdf', startPage: 1, endPage: pdfDoc.numPages },
        },
      ];
    }
    const flat: { title: string; pageNumber: number }[] = [];
    const walk = async (nodes: readonly OutlineNode[]): Promise<void> => {
      for (const n of nodes) {
        let pageNumber = 1;
        if (n.dest !== undefined && pdfDoc.getPageIndex !== undefined) {
          try {
            pageNumber = (await pdfDoc.getPageIndex(n.dest)) + 1;
          } catch {
            // Some destinations don't resolve; fall through with default.
          }
        }
        flat.push({ title: n.title, pageNumber });
        if (n.items !== undefined) await walk(n.items);
      }
    };
    await walk(outline);
    flat.sort((a, b) => a.pageNumber - b.pageNumber);

    const sections: SectionListing[] = flat.map((entry, i) => {
      const next = flat[i + 1];
      const endPage = next !== undefined ? next.pageNumber - 1 : pdfDoc.numPages;
      return {
        id: SectionId(`pdf:${String(entry.pageNumber)}:${slugify(entry.title)}`),
        title: entry.title,
        range: {
          kind: 'pdf',
          startPage: entry.pageNumber,
          endPage: Math.max(entry.pageNumber, endPage),
        },
      };
    });
    return sections;
  }

  async *streamParagraphs(
    book: Book,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (this.resolveBlob === undefined) {
      throw new Error('PdfChunkExtractor: no blob resolver configured');
    }
    if (section.range.kind !== 'pdf') {
      throw new Error('PdfChunkExtractor: EPUB section passed to PDF extractor');
    }
    const blob = await this.resolveBlob(book);
    const arrayBuffer = await blob.arrayBuffer();
    const pdfDoc = (await pdfjs.getDocument({ data: arrayBuffer }).promise) as unknown as PdfDocLike;
    yield* this.streamParagraphsFromPdfDoc(pdfDoc, section);
  }

  async *streamParagraphsFromPdfDoc(
    pdfDoc: PdfDocLike,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (section.range.kind !== 'pdf') return;
    const { startPage, endPage } = section.range;

    // Pass 1: collect text for boilerplate detection across the section.
    const allPagesText: string[][] = [];
    for (let p = startPage; p <= endPage; p++) {
      const page = await pdfDoc.getPage(p);
      const items = (await page.getTextContent()).items;
      const lines = groupItemsIntoLines(items);
      allPagesText.push(lines.map((l) => l.text));
    }
    const boilerplate = detectRunningHeadersFooters(allPagesText);

    // Pass 2: emit paragraphs.
    for (let p = startPage; p <= endPage; p++) {
      const page = await pdfDoc.getPage(p);
      const items = (await page.getTextContent()).items;
      const lines = groupItemsIntoLines(items);
      const paragraphs = groupLinesIntoParagraphs(lines);
      for (const para of paragraphs) {
        const trimmed = para.text.trim();
        if (trimmed.length === 0) continue;
        if (isPageNumberOnly(trimmed)) continue;
        if (boilerplate.has(trimmed)) continue;
        const dehyphenated = dehyphenateWordWraps(para.text);
        const locationAnchor: LocationAnchor = { kind: 'pdf', page: p };
        yield { text: dehyphenated, locationAnchor };
      }
    }
  }
}
