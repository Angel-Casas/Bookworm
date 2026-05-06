import type { Book, LocationAnchor } from '@/domain';
import { SectionId } from '@/domain';
import type {
  ChunkExtractor,
  SectionListing,
  ExtractedParagraph,
} from './extractor';

// foliate-js has no upstream types and `moduleResolution: bundler` resolves
// the .js files directly. Static imports trip noImplicitAny; we use dynamic
// imports with a path-string `as any` cast and hand-typed surface contracts.

const PARAGRAPH_TAGS = new Set([
  'P',
  'LI',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
]);

type ResolveBlob = (book: Book) => Promise<Blob>;

// foliate-js has no upstream types and is resolved directly by the bundler
// (moduleResolution: bundler). We define the surface we use as local types
// and cast at the import site.

type FoliateLoader = {
  loadText: (name: string) => Promise<string | null>;
  loadBlob: (name: string, type?: string) => Promise<Blob | null>;
  getSize: (name: string) => number;
};

type FoliateSection = {
  readonly id: string;
  readonly cfi: string | null | undefined;
  load(): Promise<unknown>;
  unload(): void;
  createDocument(): Promise<Document>;
};

type FoliateTocEntry = {
  readonly label: string;
  readonly href: string;
  readonly subitems?: readonly FoliateTocEntry[];
};

type FoliateBook = {
  readonly sections: readonly FoliateSection[];
  readonly toc?: readonly FoliateTocEntry[];
};

type ZipModule = {
  configure: (opts: { useWebWorkers: boolean }) => void;
  ZipReader: new (reader: unknown) => {
    getEntries(): Promise<readonly ZipEntry[]>;
  };
  BlobReader: new (b: Blob) => unknown;
  TextWriter: new () => unknown;
  BlobWriter: new (type?: string) => unknown;
};

type ZipEntry = {
  readonly filename: string;
  readonly uncompressedSize: number;
  getData(writer: unknown): Promise<unknown>;
};

type EpubModule = {
  EPUB: new (loader: FoliateLoader) => FoliateBook & { init(): Promise<FoliateBook> };
};

type CfiModule = {
  fromRange: (range: Range) => string;
  joinIndir: (...parts: string[]) => string;
  fake: { fromIndex: (i: number) => string };
};

// Mirrors makeZipLoader in foliate-js/view.js.
async function makeZipLoader(file: Blob): Promise<FoliateLoader> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion
  const zipApi = (await import('foliate-js/vendor/zip.js' as any)) as ZipModule;
  zipApi.configure({ useWebWorkers: false });
  const reader = new zipApi.ZipReader(new zipApi.BlobReader(file));
  const entries = await reader.getEntries();
  const map = new Map<string, ZipEntry>();
  for (const entry of entries) map.set(entry.filename, entry);
  const loadText = async (name: string): Promise<string | null> => {
    const entry = map.get(name);
    if (entry === undefined) return null;
    return entry.getData(new zipApi.TextWriter()) as Promise<string>;
  };
  const loadBlob = async (name: string, type?: string): Promise<Blob | null> => {
    const entry = map.get(name);
    if (entry === undefined) return null;
    return entry.getData(new zipApi.BlobWriter(type)) as Promise<Blob>;
  };
  const getSize = (name: string): number => map.get(name)?.uncompressedSize ?? 0;
  return { loadText, loadBlob, getSize };
}

async function loadFoliateBook(file: Blob): Promise<FoliateBook> {
  const loader = await makeZipLoader(file);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion
  const epubApi = (await import('foliate-js/epub.js' as any)) as EpubModule;
  const book = new epubApi.EPUB(loader);
  return book.init();
}

async function loadCfiApi(): Promise<CfiModule> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion
  return (await import('foliate-js/epubcfi.js' as any)) as CfiModule;
}

export class EpubChunkExtractor implements ChunkExtractor {
  constructor(private readonly resolveBlob?: ResolveBlob) {}

  async listSections(book: Book): Promise<readonly SectionListing[]> {
    if (book.format !== 'epub') {
      throw new Error(`EpubChunkExtractor: cannot list sections for ${book.format}`);
    }
    if (this.resolveBlob === undefined) {
      throw new Error('EpubChunkExtractor: no blob resolver configured');
    }
    const blob = await this.resolveBlob(book);
    return this.listSectionsFromBlob(blob, book.title);
  }

  async listSectionsFromBlob(
    blob: Blob,
    bookTitle: string,
  ): Promise<readonly SectionListing[]> {
    const book = await loadFoliateBook(blob);
    const sections = book.sections;
    if (sections.length === 0) {
      return [
        {
          id: SectionId('__whole_book__'),
          title: bookTitle,
          range: { kind: 'epub', spineIndex: 0 },
        },
      ];
    }
    return sections.map((entry, i): SectionListing => {
      const tocLabel = book.toc?.find(
        (t) => t.href === entry.id || t.href.startsWith(entry.id + '#'),
      )?.label;
      return {
        id: SectionId('spine:' + entry.id),
        title: tocLabel ?? `Section ${String(i + 1)}`,
        range: { kind: 'epub', spineIndex: i },
      };
    });
  }

  async *streamParagraphs(
    book: Book,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (this.resolveBlob === undefined) {
      throw new Error('EpubChunkExtractor: no blob resolver configured');
    }
    const blob = await this.resolveBlob(book);
    yield* this.streamParagraphsFromBlob(blob, section);
  }

  async *streamParagraphsFromBlob(
    blob: Blob,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (section.range.kind !== 'epub') {
      throw new Error('EpubChunkExtractor: PDF section passed to EPUB extractor');
    }
    const spineIndex = section.range.spineIndex;
    const book = await loadFoliateBook(blob);
    const spineEntry = book.sections[spineIndex];
    if (spineEntry === undefined) return;

    const cfiApi = await loadCfiApi();
    const baseCFI = spineEntry.cfi ?? cfiApi.fake.fromIndex(spineIndex);

    const doc = await spineEntry.createDocument();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let current: Node | null =
      walker.currentNode === doc.body ? walker.nextNode() : walker.currentNode;
    while (current !== null) {
      if (current instanceof Element && PARAGRAPH_TAGS.has(current.tagName)) {
        const text = current.textContent;
        if (text.trim().length > 0) {
          const range = doc.createRange();
          range.selectNodeContents(current);
          range.collapse(true);
          let cfi: string;
          try {
            cfi = cfiApi.joinIndir(baseCFI, cfiApi.fromRange(range));
          } catch {
            current = walker.nextNode();
            continue;
          }
          const locationAnchor: LocationAnchor = { kind: 'epub-cfi', cfi };
          yield { text, locationAnchor };
        }
      }
      current = walker.nextNode();
    }
  }
}
