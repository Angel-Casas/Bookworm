import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import type { BookFormat, LocationAnchor, TocEntry } from '@/domain';
import type {
  BookReader,
  ReaderError,
  ReaderPreferences,
} from '@/domain/reader';
import { makeReaderMachine } from './readerMachine';
import { ReaderChrome } from './ReaderChrome';
import { TocPanel } from './TocPanel';
import { TypographyPanel } from './TypographyPanel';
import './reader-view.css';

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
  bookTitle,
  bookSubtitle,
  bookFormat,
  onBack,
  loadBookForReader,
  createAdapter,
  onAnchorChange,
  onPreferencesChange,
}: ReaderViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<BookReader | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [typoOpen, setTypoOpen] = useState(false);
  const [prefs, setPrefs] = useState<ReaderPreferences | null>(null);
  const [currentEntry, setCurrentEntry] = useState<string | undefined>(undefined);

  // Stable factory: ReaderView is mounted with key={bookId} from App.tsx so
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

  const handlePrefChange = useCallback(
    (next: ReaderPreferences) => {
      setPrefs(next);
      adapterRef.current?.applyPreferences(next);
      onPreferencesChange(next);
    },
    [onPreferencesChange],
  );

  const handleTocSelect = useCallback((entry: TocEntry) => {
    void adapterRef.current?.goToAnchor(entry.anchor);
    setCurrentEntry(String(entry.id));
    setTocOpen(false);
  }, []);

  const status = state.value;

  return (
    <div className="reader-view" data-reader-theme={prefs?.theme ?? 'light'}>
      <ReaderChrome
        title={bookTitle}
        {...(bookSubtitle !== undefined && { subtitle: bookSubtitle })}
        onBack={onBack}
        onOpenToc={() => {
          setTocOpen((v) => !v);
          setTypoOpen(false);
        }}
        onOpenTypography={() => {
          setTypoOpen((v) => !v);
          setTocOpen(false);
        }}
      />
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
      {tocOpen && state.context.toc ? (
        <div className="reader-view__sheet reader-view__sheet--toc">
          <TocPanel
            toc={state.context.toc}
            {...(currentEntry !== undefined && { currentEntryId: currentEntry })}
            onSelect={handleTocSelect}
          />
        </div>
      ) : null}
      {typoOpen && prefs ? (
        <div className="reader-view__sheet reader-view__sheet--typography">
          <TypographyPanel preferences={prefs} bookFormat={bookFormat} onChange={handlePrefChange} />
        </div>
      ) : null}
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
