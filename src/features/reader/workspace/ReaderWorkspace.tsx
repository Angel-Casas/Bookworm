import { useCallback, useState } from 'react';
import { BookId, type BookFormat, type LocationAnchor } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type { BookmarksRepository } from '@/storage';
import { ReaderChrome } from '@/features/reader/ReaderChrome';
import { ReaderView, type ReaderViewExposedState } from '@/features/reader/ReaderView';
import { TocPanel } from '@/features/reader/TocPanel';
import { TypographyPanel } from '@/features/reader/TypographyPanel';
import { BookmarksPanel } from '@/features/reader/BookmarksPanel';
import { DesktopRail, type RailTab } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import { useBookmarks } from './useBookmarks';
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
  const [activeRailTab, setActiveRailTab] = useState<'contents' | 'bookmarks'>('contents');

  const bookmarks = useBookmarks({
    bookId: BookId(props.bookId),
    repo: props.bookmarksRepo,
    readerState,
  });

  const handleStateChange = useCallback((s: ReaderViewExposedState) => {
    setReaderState(s);
  }, []);

  const handleAddBookmark = useCallback((): void => {
    void bookmarks.add();
  }, [bookmarks]);

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

  const railTabs: readonly RailTab[] = [
    { key: 'contents', label: 'Contents', content: tocPanelContent },
    {
      key: 'bookmarks',
      label: 'Bookmarks',
      badge: bookmarks.list.length,
      content: bookmarksPanelContent,
    },
  ];

  const showRail = isDesktop && focus.mode === 'normal';

  const sheetTabs: readonly SheetTab[] = [
    { key: 'contents', label: 'Contents' },
    { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
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
              setActiveRailTab(key as 'contents' | 'bookmarks');
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
              setActiveRailTab(key as 'contents' | 'bookmarks');
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
    </div>
  );
}
