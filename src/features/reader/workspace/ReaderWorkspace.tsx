import { useCallback, useEffect, useState } from 'react';
import { BookId, type BookFormat, type LocationAnchor } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type { BookmarksRepository, HighlightsRepository } from '@/storage';
import type {
  Highlight,
  HighlightAnchor,
  HighlightColor,
} from '@/domain/annotations/types';
import { ReaderChrome } from '@/features/reader/ReaderChrome';
import { ReaderView, type ReaderViewExposedState } from '@/features/reader/ReaderView';
import { TocPanel } from '@/features/reader/TocPanel';
import { TypographyPanel } from '@/features/reader/TypographyPanel';
import { BookmarksPanel } from '@/features/reader/BookmarksPanel';
import { HighlightsPanel } from '@/features/reader/HighlightsPanel';
import { HighlightToolbar } from '@/features/reader/HighlightToolbar';
import { DesktopRail, type RailTab } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import { useBookmarks } from './useBookmarks';
import { useHighlights } from './useHighlights';
import './workspace.css';

type Props = {
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
  readonly initialFocusMode: FocusMode;
  readonly hasShownFirstTimeHint: boolean;
  readonly onFocusModeChange: (mode: FocusMode) => Promise<void>;
  readonly onFirstTimeHintShown: () => void;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
};

type SheetTab = { key: string; label: string; badge?: number };

function SheetTabHeader({
  tabs,
  activeKey,
  onTabChange,
}: {
  readonly tabs: readonly SheetTab[];
  readonly activeKey: string;
  readonly onTabChange: (key: string) => void;
}) {
  return (
    <div className="reader-workspace__sheet-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === activeKey}
          className={
            tab.key === activeKey
              ? 'reader-workspace__sheet-tab reader-workspace__sheet-tab--active'
              : 'reader-workspace__sheet-tab'
          }
          onClick={() => {
            onTabChange(tab.key);
          }}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 ? (
            <span className="reader-workspace__sheet-badge">{tab.badge}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const FOCUS_HINT_TEXT =
  'Move the cursor to the top to bring the menu back · F or Esc to exit';

type RailTabKey = 'contents' | 'bookmarks' | 'highlights';

type ActiveToolbar =
  | {
      kind: 'create';
      anchor: HighlightAnchor;
      selectedText: string;
      rect: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: 'edit';
      highlight: Highlight;
      pos: { x: number; y: number; width: number; height: number };
    }
  | null;

export function ReaderWorkspace(props: Props) {
  const viewport = useViewport();
  const focus = useFocusMode({
    initial: props.initialFocusMode,
    onChange: (mode) => {
      void props.onFocusModeChange(mode);
    },
    hasShownFirstTimeHint: props.hasShownFirstTimeHint,
    onFirstTimeHintShown: props.onFirstTimeHintShown,
  });

  const [activeSheet, setActiveSheet] = useState<'toc' | 'typography' | null>(null);
  const [readerState, setReaderState] = useState<ReaderViewExposedState | null>(null);
  const [activeRailTab, setActiveRailTab] = useState<RailTabKey>('contents');
  const [activeToolbar, setActiveToolbar] = useState<ActiveToolbar>(null);

  const bookmarks = useBookmarks({
    bookId: BookId(props.bookId),
    repo: props.bookmarksRepo,
    readerState,
  });
  const highlights = useHighlights({
    bookId: BookId(props.bookId),
    repo: props.highlightsRepo,
    readerState,
  });

  const handleStateChange = useCallback((s: ReaderViewExposedState) => {
    setReaderState(s);
  }, []);

  const handleAddBookmark = useCallback((): void => {
    void bookmarks.add();
  }, [bookmarks]);

  // Initial render of persisted highlights into the engine (once both ready).
  useEffect(() => {
    if (!readerState) return;
    readerState.loadHighlights(highlights.list);
  }, [readerState, highlights.list]);

  // Subscribe to engine selection events → drive create-toolbar.
  useEffect(() => {
    if (!readerState) return;
    return readerState.onSelectionChange((sel) => {
      if (sel === null) {
        setActiveToolbar((t) => (t?.kind === 'create' ? null : t));
      } else {
        setActiveToolbar({
          kind: 'create',
          anchor: sel.anchor,
          selectedText: sel.selectedText,
          rect: sel.screenRect,
        });
      }
    });
  }, [readerState]);

  // Subscribe to engine highlight-tap events → drive edit-toolbar.
  useEffect(() => {
    if (!readerState) return;
    return readerState.onHighlightTap((id, pos) => {
      const h = highlights.list.find((x) => x.id === id);
      if (!h) return;
      setActiveToolbar({
        kind: 'edit',
        highlight: h,
        pos: { x: pos.x, y: pos.y, width: 1, height: 1 },
      });
    });
  }, [readerState, highlights.list]);

  const handleCreatePick = useCallback(
    (color: HighlightColor): void => {
      if (activeToolbar?.kind !== 'create') return;
      void highlights.add(activeToolbar.anchor, activeToolbar.selectedText, color);
      setActiveToolbar(null);
      window.getSelection()?.removeAllRanges();
    },
    [activeToolbar, highlights],
  );

  const handleEditPick = useCallback(
    (color: HighlightColor): void => {
      if (activeToolbar?.kind !== 'edit') return;
      void highlights.changeColor(activeToolbar.highlight, color);
      setActiveToolbar(null);
    },
    [activeToolbar, highlights],
  );

  const handleEditDelete = useCallback((): void => {
    if (activeToolbar?.kind !== 'edit') return;
    void highlights.remove(activeToolbar.highlight);
    setActiveToolbar(null);
  }, [activeToolbar, highlights]);

  const dismissToolbar = useCallback((): void => {
    setActiveToolbar(null);
  }, []);

  const isDesktop = viewport === 'desktop';

  const tocPanelContent = readerState?.toc ? (
    <TocPanel
      toc={readerState.toc}
      {...(readerState.currentEntryId !== undefined && {
        currentEntryId: readerState.currentEntryId,
      })}
      onSelect={(entry) => {
        readerState.goToAnchor(entry.anchor);
      }}
    />
  ) : (
    <aside className="toc-panel toc-panel--empty">
      <p>Loading…</p>
    </aside>
  );

  const bookmarksPanelContent = (
    <BookmarksPanel
      bookmarks={bookmarks.list}
      onSelect={(b) => {
        readerState?.goToAnchor(b.anchor);
      }}
      onDelete={(b) => {
        void bookmarks.remove(b);
      }}
    />
  );

  const highlightsPanelContent = (
    <HighlightsPanel
      highlights={highlights.list}
      onSelect={(h) => {
        const anchor: LocationAnchor =
          h.anchor.kind === 'epub-cfi'
            ? { kind: 'epub-cfi', cfi: h.anchor.cfi }
            : { kind: 'pdf', page: h.anchor.page };
        readerState?.goToAnchor(anchor);
      }}
      onDelete={(h) => {
        void highlights.remove(h);
      }}
      onChangeColor={(h, color) => {
        void highlights.changeColor(h, color);
      }}
    />
  );

  const railTabs: readonly RailTab[] = [
    { key: 'contents', label: 'Contents', content: tocPanelContent },
    {
      key: 'bookmarks',
      label: 'Bookmarks',
      badge: bookmarks.list.length,
      content: bookmarksPanelContent,
    },
    {
      key: 'highlights',
      label: 'Highlights',
      badge: highlights.list.length,
      content: highlightsPanelContent,
    },
  ];

  const showRail = isDesktop && focus.mode === 'normal';

  const sheetTabs: readonly SheetTab[] = [
    { key: 'contents', label: 'Contents' },
    { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
    { key: 'highlights', label: 'Highlights', badge: highlights.list.length },
  ];

  return (
    <div className="reader-workspace" data-mode={focus.mode} data-viewport={viewport}>
      {focus.shouldRenderChrome ? (
        <ReaderChrome
          title={props.bookTitle}
          {...(props.bookSubtitle !== undefined && { subtitle: props.bookSubtitle })}
          onBack={props.onBack}
          onOpenToc={() => {
            setActiveSheet('toc');
          }}
          onOpenTypography={() => {
            setActiveSheet('typography');
          }}
          onToggleFocus={() => {
            focus.toggle();
          }}
          onAddBookmark={handleAddBookmark}
          showTocButton={!isDesktop}
          showFocusToggle={isDesktop}
          focusMode={focus.mode}
        />
      ) : null}

      <div className="reader-workspace__body">
        {showRail ? (
          <DesktopRail
            tabs={railTabs}
            activeKey={activeRailTab}
            onTabChange={(key) => {
              setActiveRailTab(key as RailTabKey);
            }}
          />
        ) : null}
        <div className="reader-workspace__reader-host">
          <ReaderView
            bookId={props.bookId}
            bookTitle={props.bookTitle}
            bookFormat={props.bookFormat}
            {...(props.bookSubtitle !== undefined && { bookSubtitle: props.bookSubtitle })}
            onBack={props.onBack}
            loadBookForReader={props.loadBookForReader}
            createAdapter={props.createAdapter}
            onAnchorChange={props.onAnchorChange}
            onPreferencesChange={props.onPreferencesChange}
            onStateChange={handleStateChange}
          />
        </div>
      </div>

      {!isDesktop && activeSheet === 'toc' ? (
        <MobileSheet
          onDismiss={() => {
            setActiveSheet(null);
          }}
        >
          <SheetTabHeader
            tabs={sheetTabs}
            activeKey={activeRailTab}
            onTabChange={(key) => {
              setActiveRailTab(key as RailTabKey);
            }}
          />
          {activeRailTab === 'contents' && readerState?.toc ? (
            <TocPanel
              toc={readerState.toc}
              {...(readerState.currentEntryId !== undefined && {
                currentEntryId: readerState.currentEntryId,
              })}
              onSelect={(entry) => {
                readerState.goToAnchor(entry.anchor);
                setActiveSheet(null);
              }}
            />
          ) : null}
          {activeRailTab === 'bookmarks' ? (
            <BookmarksPanel
              bookmarks={bookmarks.list}
              onSelect={(b) => {
                readerState?.goToAnchor(b.anchor);
                setActiveSheet(null);
              }}
              onDelete={(b) => {
                void bookmarks.remove(b);
              }}
            />
          ) : null}
          {activeRailTab === 'highlights' ? (
            <HighlightsPanel
              highlights={highlights.list}
              onSelect={(h) => {
                const anchor: LocationAnchor =
                  h.anchor.kind === 'epub-cfi'
                    ? { kind: 'epub-cfi', cfi: h.anchor.cfi }
                    : { kind: 'pdf', page: h.anchor.page };
                readerState?.goToAnchor(anchor);
                setActiveSheet(null);
              }}
              onDelete={(h) => {
                void highlights.remove(h);
              }}
              onChangeColor={(h, color) => {
                void highlights.changeColor(h, color);
              }}
            />
          ) : null}
        </MobileSheet>
      ) : null}

      {activeSheet === 'typography' && readerState?.prefs ? (
        <MobileSheet
          onDismiss={() => {
            setActiveSheet(null);
          }}
        >
          <TypographyPanel
            preferences={readerState.prefs}
            bookFormat={props.bookFormat}
            onChange={readerState.applyPreferences}
          />
        </MobileSheet>
      ) : null}

      {focus.firstTimeHintVisible ? (
        <div className="reader-workspace__hint" role="status">
          {FOCUS_HINT_TEXT}
        </div>
      ) : null}

      {activeToolbar?.kind === 'create' ? (
        <HighlightToolbar
          mode="create"
          screenRect={activeToolbar.rect}
          onPickColor={handleCreatePick}
          onDismiss={dismissToolbar}
        />
      ) : null}
      {activeToolbar?.kind === 'edit' ? (
        <HighlightToolbar
          mode="edit"
          screenRect={activeToolbar.pos}
          currentColor={activeToolbar.highlight.color}
          onPickColor={handleEditPick}
          onDelete={handleEditDelete}
          onDismiss={dismissToolbar}
        />
      ) : null}
    </div>
  );
}
