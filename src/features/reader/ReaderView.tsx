import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import type { BookFormat, LocationAnchor, TocEntry } from '@/domain';
import type {
  BookReader,
  ReaderError,
  ReaderPreferences,
} from '@/domain/reader';
import { makeReaderMachine } from './readerMachine';
import './reader-view.css';

export type ReaderViewExposedState = {
  readonly toc: readonly TocEntry[] | null;
  readonly currentEntryId: string | undefined;
  readonly prefs: ReaderPreferences | null;
  readonly goToAnchor: (anchor: LocationAnchor) => void;
  readonly applyPreferences: (prefs: ReaderPreferences) => void;
};

type ReaderViewProps = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly bookFormat: BookFormat;
  readonly onBack: () => void;
  readonly loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  readonly createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  readonly onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  readonly onPreferencesChange: (prefs: ReaderPreferences) => void;
  readonly onStateChange?: (state: ReaderViewExposedState) => void;
};

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn(...args);
    }, ms);
  }) as T;
}

export function ReaderView({
  bookId,
  bookFormat,
  onBack,
  loadBookForReader,
  createAdapter,
  onAnchorChange,
  onPreferencesChange,
  onStateChange,
}: ReaderViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<BookReader | null>(null);
  const [prefs, setPrefs] = useState<ReaderPreferences | null>(null);
  const [currentEntryId, setCurrentEntryId] = useState<string | undefined>(undefined);

  // Stable factory: ReaderView is mounted with key={bookId} from parent so
  // a book switch remounts the whole component, but a parent re-render that
  // changes the createAdapter / load callback identity should rebuild the
  // machine cleanly.
  const machine = useMemo(
    () =>
      makeReaderMachine({
        loadBookForReader,
        createAdapter: () => {
          if (!mountRef.current) {
            throw new Error('ReaderView: mount node not ready');
          }
          const adapter = createAdapter(mountRef.current, bookFormat);
          adapterRef.current = adapter;
          return adapter;
        },
      }),
    [loadBookForReader, createAdapter, bookFormat],
  );

  const [state, send] = useMachine(machine);

  // Kick off OPEN once the mount node is in the DOM
  useEffect(() => {
    send({ type: 'OPEN', bookId });
    return () => {
      send({ type: 'CLOSE' });
      adapterRef.current = null;
    };
  }, [bookId, send]);

  // Initialize preferences from the loaded preferences (one-shot)
  useEffect(() => {
    if (state.context.preferences && !prefs) setPrefs(state.context.preferences);
  }, [state.context.preferences, prefs]);

  // Apply theme to the document while the reader is mounted
  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = prefs.theme === 'dark' ? 'dark' : 'light';
    root.dataset.readerTheme = prefs.theme;
    return () => {
      if (previous === undefined) {
        delete root.dataset.theme;
      } else {
        root.dataset.theme = previous;
      }
      delete root.dataset.readerTheme;
    };
  }, [prefs]);

  // Subscribe to location changes once ready, debounce-save, sync flush on hide
  const isReady = state.matches('ready');
  useEffect(() => {
    if (!isReady || !adapterRef.current) return;
    const adapter = adapterRef.current;
    const saveDebounced = debounce((anchor: LocationAnchor) => {
      onAnchorChange(bookId, anchor);
    }, 500);
    const unsubscribe = adapter.onLocationChange((anchor) => {
      saveDebounced(anchor);
    });
    const flush = () => {
      try {
        const anchor = adapter.getCurrentAnchor();
        onAnchorChange(bookId, anchor);
      } catch (err) {
        console.warn('[reader] flush failed', err);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [isReady, bookId, onAnchorChange]);

  const applyPreferences = useCallback(
    (next: ReaderPreferences) => {
      setPrefs(next);
      adapterRef.current?.applyPreferences(next);
      onPreferencesChange(next);
    },
    [onPreferencesChange],
  );

  const goToAnchor = useCallback((anchor: LocationAnchor) => {
    void adapterRef.current?.goToAnchor(anchor);
    // Find a TOC entry whose anchor matches; if so, mark current.
    // For PDFs (kind:'pdf') match by page; for EPUBs (kind:'epub-cfi') match by cfi.
    // This is best-effort — the workspace renders highlight visually.
  }, []);

  // Surface state to parent (workspace) — fires whenever any input changes.
  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      toc: state.context.toc,
      currentEntryId,
      prefs,
      goToAnchor,
      applyPreferences,
    });
  }, [onStateChange, state.context.toc, prefs, currentEntryId, goToAnchor, applyPreferences]);

  // Track current entry when goToAnchor is called via the workspace's handler.
  // Workspace passes us an entry through onSelect → adapter.goToAnchor; we mark
  // currentEntryId so the rail/sheet can highlight it. Workspace calls our
  // exposed goToAnchor with anchor only — no entry id available — so the
  // workspace-side onSelect can call setCurrentEntryId via context if it
  // wants. For v2.3 we keep currentEntryId undefined unless explicitly
  // tracked elsewhere (covered by Phase 3 polish).
  void setCurrentEntryId;

  const status = state.value;

  return (
    <div className="reader-view" data-reader-theme={prefs?.theme ?? 'light'}>
      <div className="reader-view__body">
        <div ref={mountRef} className="reader-view__mount" aria-label="Book content" />
        {status === 'loadingBlob' || status === 'opening' ? (
          <div className="reader-view__overlay" role="status">
            Opening book…
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="reader-view__overlay reader-view__overlay--error" role="alert">
            <p>{describeError(state.context.error)}</p>
            <button type="button" onClick={onBack}>
              Back to library
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function describeError(err: ReaderError | null): string {
  if (!err) return 'Something went wrong opening this book.';
  switch (err.kind) {
    case 'blob-missing':
      return 'This book is no longer in your library.';
    case 'parse-failed':
      return `Could not open this book: ${err.reason}`;
    case 'unsupported-format':
      return `Unsupported format: ${err.format}`;
    case 'engine-crashed':
      return 'The reader crashed. Try opening the book again.';
  }
}
