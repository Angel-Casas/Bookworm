import {
  type BookwormDB,
  createBookRepository,
  createOpfsAdapter,
  createSettingsRepository,
  type OpfsAdapter,
  type BookRepository,
  type SettingsRepository,
} from '@/storage';
import { BookId, IsoTimestamp, type Book, type ParsedMetadata } from '@/domain';
import type { ImportInput } from './import/importMachine';
import { detectFormat } from './import/parsers/format';
import { parsePdfMetadata } from './import/parsers/pdf';

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const coverExtensionFor = (mimeType: string): string => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/svg+xml') return 'svg';
  if (mimeType === 'image/gif') return 'gif';
  return 'bin';
};

export type Wiring = {
  readonly db: BookwormDB;
  readonly bookRepo: BookRepository;
  readonly settingsRepo: SettingsRepository;
  readonly opfs: OpfsAdapter;
  readonly importDeps: Omit<ImportInput, 'file'>;
  persistFirstQuotaRequest(): Promise<void>;
};

export function createWiring(db: BookwormDB): Wiring {
  const bookRepo = createBookRepository(db);
  const settingsRepo = createSettingsRepository(db);
  const opfs = createOpfsAdapter();

  let workerSingleton: Worker | null = null;
  const ensureWorker = (): Worker => {
    if (workerSingleton) return workerSingleton;
    workerSingleton = new Worker(
      new URL('./import/workers/import-parser.worker.ts', import.meta.url),
      { type: 'module' },
    );
    return workerSingleton;
  };

  const importDeps: Omit<ImportInput, 'file'> = {
    readBytes(file) {
      return file.arrayBuffer();
    },
    async hashBytes(bytes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return toHex(digest);
    },
    findByChecksum(checksum) {
      return bookRepo.findByChecksum(checksum);
    },
    async parseInWorker({ bytes, mimeType, originalName }) {
      // PDFs run pdf.js on the main thread (its own nested worker is fragile
      // when started from inside another worker). EPUBs route to the parser
      // worker (fflate is self-contained).
      const format = detectFormat(bytes);
      if (format === 'pdf') {
        const result = await parsePdfMetadata(bytes, originalName);
        if (result.kind === 'ok') return result.metadata;
        throw new Error(result.reason);
      }
      const w = ensureWorker();
      return new Promise<ParsedMetadata>((resolve, reject) => {
        const onMessage = (
          event: MessageEvent<
            | { kind: 'ok'; metadata: ParsedMetadata }
            | { kind: 'error'; reason: string }
          >,
        ) => {
          w.removeEventListener('message', onMessage);
          if (event.data.kind === 'ok') resolve(event.data.metadata);
          else reject(new Error(event.data.reason));
        };
        w.addEventListener('message', onMessage);
        w.postMessage({ bytes, mimeType, originalName }, [bytes]);
      });
    },
    async persistBook({ file, bytes, metadata, checksum }) {
      const id = BookId(crypto.randomUUID());
      const ext = metadata.format === 'pdf' ? 'pdf' : 'epub';
      const sourcePath = `books/${id}/source.${ext}`;
      await opfs.writeFile(sourcePath, file);
      let coverRef: Book['coverRef'] = { kind: 'none' };
      if (metadata.cover) {
        const coverExt = coverExtensionFor(metadata.cover.mimeType);
        const coverPath = `books/${id}/cover.${coverExt}`;
        await opfs.writeFile(
          coverPath,
          new Blob([metadata.cover.bytes], { type: metadata.cover.mimeType }),
        );
        coverRef = { kind: 'opfs', path: coverPath };
      }
      const now = IsoTimestamp(new Date().toISOString());
      const book: Book = {
        id,
        title: metadata.title,
        ...(metadata.author !== undefined && { author: metadata.author }),
        format: metadata.format,
        coverRef,
        toc: [],
        source: {
          kind: 'imported-file',
          opfsPath: sourcePath,
          originalName: file.name,
          byteSize: bytes.byteLength,
          mimeType:
            file.type ||
            (metadata.format === 'epub' ? 'application/epub+zip' : 'application/pdf'),
          checksum,
        },
        importStatus: { kind: 'ready' },
        indexingStatus: { kind: 'pending' },
        aiProfileStatus: { kind: 'pending' },
        createdAt: now,
        updatedAt: now,
      };
      await bookRepo.put(book);
      return book;
    },
  };

  const persistFirstQuotaRequest = async (): Promise<void> => {
    const existing = await settingsRepo.getStoragePersistResult();
    if (existing) return;
    if (typeof navigator === 'undefined') return;
    const granted = await navigator.storage.persist();
    await settingsRepo.setStoragePersistResult(granted ? 'granted' : 'denied');
  };

  return { db, bookRepo, settingsRepo, opfs, importDeps, persistFirstQuotaRequest };
}
