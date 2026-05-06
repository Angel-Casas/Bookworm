import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { openBookwormDB } from '@/storage';
import type { Book, BookId } from '@/domain';
import { createLibraryStore, type LibraryStore } from '@/features/library/store/libraryStore';
import { createCoverCache, type CoverCache } from '@/features/library/store/coverCache';
import { createImportStore, type ImportStore } from '@/features/library/import/importStore';
import { createWiring, type Wiring } from '@/features/library/wiring';
import { loadLibrary } from '@/features/library/boot/loadLibrary';
import { sweepOrphans } from '@/features/library/orphan-sweep';
import { LibraryView } from '@/features/library/LibraryView';
import { LibraryBootError } from '@/features/library/LibraryBootError';
import { DropOverlay } from '@/features/library/DropOverlay';
import { ReaderWorkspace } from '@/features/reader/workspace/ReaderWorkspace';
import { NotebookView } from '@/features/annotations/notebook/NotebookView';
import { SettingsView } from '@/features/ai/settings/SettingsView';
import { useApiKeyStore } from '@/features/ai/key/apiKeyStore';
import { useModelCatalogStore } from '@/features/ai/models/modelCatalogStore';
import { useAppView } from '@/app/useAppView';
import { useReaderHost } from '@/app/useReaderHost';
import { useIndexing } from '@/features/library/indexing/useIndexing';
import { EpubChunkExtractor } from '@/features/library/indexing/EpubChunkExtractor';
import { PdfChunkExtractor } from '@/features/library/indexing/PdfChunkExtractor';
import { IndexInspectorModal } from '@/features/library/indexing/IndexInspectorModal';
import { embed as nanogptEmbed } from '@/features/ai/chat/nanogptEmbeddings';
import type { EmbedClient } from '@/features/library/indexing/embeddings/types';
import { LIBRARY_VIEW, type AppView } from '@/app/view';
import type { FocusMode } from '@/domain/reader';
import './app.css';

type ReadyBoot = {
  readonly kind: 'ready';
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly initialView: AppView;
  readonly initialFocusMode: FocusMode;
  readonly initialFocusModeHintShown: boolean;
  readonly initialRightRailVisible: boolean;
  readonly initialChatPanelHintShown: boolean;
};

type BootState =
  | { readonly kind: 'loading' }
  | ReadyBoot
  | { readonly kind: 'error'; readonly reason: string };

function useHasBooks(libraryStore: LibraryStore): boolean {
  return useSyncExternalStore(
    (cb) => libraryStore.subscribe(cb),
    () => libraryStore.getState().books.length > 0,
    () => libraryStore.getState().books.length > 0,
  );
}

function useHasImportActivity(importStore: ImportStore): boolean {
  return useSyncExternalStore(
    (cb) => importStore.subscribe(cb),
    () => importStore.getState().entries.length > 0,
    () => importStore.getState().entries.length > 0,
  );
}

function ReadyApp({ boot }: { readonly boot: ReadyBoot }) {
  const {
    wiring,
    libraryStore,
    importStore,
    coverCache,
    initialView,
    initialFocusMode,
    initialFocusModeHintShown,
    initialRightRailVisible,
    initialChatPanelHintShown,
  } = boot;
  const view = useAppView({
    settingsRepo: wiring.settingsRepo,
    libraryStore,
    initial: initialView,
  });

  // Phase 5.1: indexing extractors (depend on opfs to read book blobs).
  const resolveBlob = useCallback(
    async (book: Book): Promise<Blob> => {
      const blob = await wiring.opfs.readFile(book.source.opfsPath);
      if (blob === undefined) {
        throw new Error(`opfs: book blob missing at ${book.source.opfsPath}`);
      }
      return blob;
    },
    [wiring.opfs],
  );
  const epubExtractor = useMemo(
    () => new EpubChunkExtractor(resolveBlob),
    [resolveBlob],
  );
  const pdfExtractor = useMemo(
    () => new PdfChunkExtractor(resolveBlob),
    [resolveBlob],
  );
  const getApiKeyForEmbed = useCallback((): string => {
    const s = useApiKeyStore.getState().state;
    if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
    return '';
  }, []);
  const embedClient = useMemo<EmbedClient>(
    () => ({
      embed: (req) =>
        nanogptEmbed({
          apiKey: getApiKeyForEmbed(),
          modelId: req.modelId,
          inputs: req.inputs,
          ...(req.signal !== undefined ? { signal: req.signal } : {}),
        }),
    }),
    [getApiKeyForEmbed],
  );
  const indexing = useIndexing({
    booksRepo: wiring.bookRepo,
    chunksRepo: wiring.bookChunksRepo,
    embeddingsRepo: wiring.bookEmbeddingsRepo,
    epubExtractor,
    pdfExtractor,
    embedClient,
  });

  const retrievalDeps = useMemo(
    () => ({
      chunksRepo: wiring.bookChunksRepo,
      embeddingsRepo: wiring.bookEmbeddingsRepo,
      embedClient,
    }),
    [wiring.bookChunksRepo, wiring.bookEmbeddingsRepo, embedClient],
  );

  // Wire the import → enqueue pipeline. wiring.persistBook calls a stored
  // callback on each successful import; useIndexing isn't available until
  // render time, so we set the callback in an effect.
  useEffect(() => {
    wiring.setOnBookImported((bookId) => {
      indexing.enqueue(bookId);
    });
  }, [wiring, indexing]);

  const reader = useReaderHost({
    wiring,
    libraryStore,
    view: view.current,
    initialFocusMode,
    initialFocusModeHintShown,
    initialRightRailVisible,
    initialChatPanelHintShown,
    onBookRemovedFromActiveView: view.goLibrary,
    onBookRemovedCancelIndexing: indexing.cancel,
  });

  // Inspector modal state.
  const [inspectorBookId, setInspectorBookId] = useState<BookId | null>(null);
  const inspectorBook =
    inspectorBookId !== null ? reader.findBook(inspectorBookId) : undefined;
  const apiKeyState = useApiKeyStore((s) => s.state);
  const selectedModelId = useModelCatalogStore((s) => s.selectedId);
  const getApiKey = useCallback((): string | null => {
    const s = useApiKeyStore.getState().state;
    if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
    return null;
  }, []);
  const hasBooks = useHasBooks(libraryStore);
  const hasImportActivity = useHasImportActivity(importStore);
  const showWorkspace = hasBooks || hasImportActivity;

  // Wrap loadBookForReader so it consumes any pending anchor queued by
  // view.goReaderAt (notebook → reader at anchor). Memoized on the
  // specific stable function refs (not the parent objects, which are new
  // each render) so ReaderView's effect — which has loadBookForReader as
  // a dep — doesn't re-run every render and re-mount the iframe.
  const innerLoadBookForReader = reader.loadBookForReader;
  const consumePendingAnchor = view.consumePendingAnchor;
  const loadBookForReader = useCallback(
    async (bookId: string) => {
      const result = await innerLoadBookForReader(bookId);
      const pending = consumePendingAnchor();
      return pending ? { ...result, initialAnchor: pending } : result;
    },
    [innerLoadBookForReader, consumePendingAnchor],
  );

  // Forward picked files from useReaderHost to importStore.
  useEffect(() => {
    const onPicked = (e: Event): void => {
      const files = (e as CustomEvent<readonly File[]>).detail;
      for (const file of files) importStore.getState().enqueue(file);
    };
    window.addEventListener('bookworm:files-picked', onPicked);
    return () => {
      window.removeEventListener('bookworm:files-picked', onPicked);
    };
  }, [importStore]);

  useEffect(() => {
    const onHide = (): void => {
      coverCache.forgetAll();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
    };
  }, [coverCache]);

  if (view.current.kind === 'notebook') {
    const book = reader.findBook(view.current.bookId);
    if (!book) return null;
    return (
      <div className="app">
        <NotebookView
          key={view.current.bookId}
          bookId={view.current.bookId}
          bookTitle={book.title}
          bookmarksRepo={reader.bookmarksRepo}
          highlightsRepo={reader.highlightsRepo}
          notesRepo={reader.notesRepo}
          savedAnswersRepo={reader.savedAnswersRepo}
          onBack={() => {
            view.goReader(book);
          }}
          onJumpToAnchor={(anchor) => {
            view.goReaderAt(book.id, anchor);
          }}
        />
      </div>
    );
  }

  if (view.current.kind === 'settings') {
    return (
      <div className="app">
        <SettingsView settingsRepo={wiring.settingsRepo} onClose={view.goLibrary} />
      </div>
    );
  }

  if (view.current.kind === 'reader') {
    const book = reader.findBook(view.current.bookId);
    if (!book) return null; // useAppView guard falls back to library next render
    return (
      <div className="app">
        <ReaderWorkspace
          key={view.current.bookId}
          bookId={view.current.bookId}
          bookTitle={book.title}
          bookFormat={book.format}
          {...(book.author !== undefined && { bookSubtitle: book.author })}
          onBack={view.goLibrary}
          loadBookForReader={loadBookForReader}
          createAdapter={reader.createAdapter}
          onAnchorChange={reader.onAnchorChange}
          onPreferencesChange={reader.onPreferencesChange}
          initialFocusMode={reader.initialFocusMode}
          hasShownFirstTimeHint={reader.hasShownFirstTimeHint}
          onFocusModeChange={reader.onFocusModeChange}
          onFirstTimeHintShown={reader.onFirstTimeHintShown}
          bookmarksRepo={reader.bookmarksRepo}
          highlightsRepo={reader.highlightsRepo}
          notesRepo={reader.notesRepo}
          chatThreadsRepo={reader.chatThreadsRepo}
          chatMessagesRepo={reader.chatMessagesRepo}
          savedAnswersRepo={reader.savedAnswersRepo}
          onOpenNotebook={() => {
            view.goNotebook(book.id);
          }}
          onOpenSettings={view.goSettings}
          initialRightRailVisible={reader.initialRightRailVisible}
          onRightRailVisibilityChange={reader.onRightRailVisibilityChange}
          initialChatPanelHintShown={reader.initialChatPanelHintShown}
          onChatPanelHintDismiss={reader.onChatPanelHintDismiss}
          apiKeyState={apiKeyState}
          getApiKey={getApiKey}
          selectedModelId={selectedModelId}
          retrievalDeps={retrievalDeps}
          bookChunksRepo={wiring.bookChunksRepo}
          bookEmbeddingsRepo={wiring.bookEmbeddingsRepo}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <LibraryView
        libraryStore={libraryStore}
        importStore={importStore}
        coverCache={coverCache}
        hasBooks={showWorkspace}
        onFilesPicked={reader.onFilesPicked}
        onPersistSort={reader.onPersistSort}
        onRemoveBook={reader.onRemoveBook}
        onOpenBook={view.goReader}
        onOpenSettings={view.goSettings}
        onOpenInspector={(bookId) => {
          setInspectorBookId(bookId);
        }}
        onRetryIndex={(bookId) => {
          void indexing.rebuild(bookId);
        }}
      />
      <DropOverlay onFilesDropped={reader.onFilesPicked} />
      {inspectorBookId !== null && inspectorBook !== undefined ? (
        <IndexInspectorModal
          bookId={inspectorBookId}
          bookTitle={inspectorBook.title}
          chunksRepo={wiring.bookChunksRepo}
          embeddingsRepo={wiring.bookEmbeddingsRepo}
          onRebuild={(id) => indexing.rebuild(id)}
          onClose={() => {
            setInspectorBookId(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function App() {
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    void (async () => {
      try {
        const db = await openBookwormDB();
        if (!activeRef.current) return;
        const wiring = createWiring(db);
        const libraryStore = createLibraryStore();
        const coverCache = createCoverCache(wiring.opfs);
        const importStore = createImportStore(wiring.importDeps);

        importStore.subscribe((s) => {
          for (const e of s.entries) {
            if (e.status.kind === 'done') {
              libraryStore.getState().upsertBook(e.status.book);
            }
          }
        });

        await loadLibrary({ store: libraryStore, openDB: () => Promise.resolve(db) });
        void sweepOrphans(wiring.opfs, wiring.bookRepo, wiring.readingProgressRepo).catch(() => {
          /* best effort */
        });
        const [
          persistedView,
          prefs,
          hintShown,
          apiKeyBlob,
          catalogSnapshot,
          selectedId,
          chatHintShown,
        ] = await Promise.all([
          wiring.settingsRepo.getView(),
          wiring.readerPreferencesRepo.get(),
          wiring.settingsRepo.getFocusModeHintShown(),
          wiring.settingsRepo.getApiKeyBlob(),
          wiring.settingsRepo.getModelCatalog(),
          wiring.settingsRepo.getSelectedModelId(),
          wiring.settingsRepo.getChatPanelHintShown(),
        ]);
        if (apiKeyBlob) {
          useApiKeyStore.getState().markLocked();
        }
        if (catalogSnapshot) {
          useModelCatalogStore
            .getState()
            .setReady(catalogSnapshot.models, catalogSnapshot.fetchedAt);
        }
        if (selectedId !== undefined) {
          useModelCatalogStore.getState().setSelectedId(selectedId);
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (!activeRef.current) return;
        setBoot({
          kind: 'ready',
          wiring,
          libraryStore,
          importStore,
          coverCache,
          initialView: persistedView ?? LIBRARY_VIEW,
          initialFocusMode: prefs.focusMode,
          initialFocusModeHintShown: hintShown,
          initialRightRailVisible: prefs.rightRailVisible,
          initialChatPanelHintShown: chatHintShown,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        if (activeRef.current) setBoot({ kind: 'error', reason });
      }
    })();
    return () => {
      activeRef.current = false;
    };
  }, []);

  if (boot.kind === 'loading') {
    return (
      <main className="app app--loading">
        <p className="app__loading">Reaching for your library…</p>
      </main>
    );
  }
  if (boot.kind === 'error') {
    return <LibraryBootError reason={boot.reason} />;
  }
  return <ReadyApp boot={boot} />;
}
