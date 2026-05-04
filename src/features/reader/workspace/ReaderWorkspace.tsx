import { useCallback, useEffect, useState } from 'react';
import { BookId, HighlightId, type BookFormat, type LocationAnchor } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type { BookmarksRepository, HighlightsRepository, NotesRepository } from '@/storage';
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
import { NoteEditor } from '@/features/reader/NoteEditor';
import { DesktopRail, type RailTab } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import { useBookmarks } from './useBookmarks';
import { useHighlights } from './useHighlights';
import { useNotes } from './useNotes';
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
  readonly notesRepo: NotesRepository;
  readonly isNoteEditorHintShown: boolean;
  readonly markNoteEditorHintShown: () => void;
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
  const [activeNoteEditor, setActiveNoteEditor] = useState<
    | {
        highlightId: HighlightId;
        anchorRect: { x: number; y: number; width: number; height: number };
      }
    | null
  >(null);

  const bookmarks = useBookmarks({
    bookId: BookId(props.bookId),
    repo: props.bookmarksRepo,
    readerState,
  });
  const notes = useNotes({
    bookId: BookId(props.bookId),
    repo: props.notesRepo,
  });
  const highlights = useHighlights({
    bookId: BookId(props.bookId),
    repo: props.highlightsRepo,
    readerState,
    onAfterRemove: (h) => {
      void notes.clear(h.id);
    },
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

  const handleCreateNote = useCallback((): void => {
    if (activeToolbar?.kind !== 'create') return;
    const rect = activeToolbar.rect;
    void highlights
      .add(activeToolbar.anchor, activeToolbar.selectedText, 'yellow')
      .then((h) => {
        setActiveNoteEditor({ highlightId: h.id, anchorRect: rect });
      });
    setActiveToolbar(null);
    window.getSelection()?.removeAllRanges();
  }, [activeToolbar, highlights]);

  const handleEditNote = useCallback((): void => {
    if (activeToolbar?.kind !== 'edit') return;
    setActiveNoteEditor({
      highlightId: activeToolbar.highlight.id,
      anchorRect: activeToolbar.pos,
    });
    setActiveToolbar(null);
  }, [activeToolbar]);

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
      notesByHighlightId={notes.byHighlightId}
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
      onSaveNote={(h, content) => {
        void notes.save(h.id, content);
      }}
      hintShown={props.isNoteEditorHintShown}
      onHintDismissed={props.markNoteEditorHintShown}
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
              notesByHighlightId={notes.byHighlightId}
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
              onSaveNote={(h, content) => {
                void notes.save(h.id, content);
              }}
              hintShown={props.isNoteEditorHintShown}
              onHintDismissed={props.markNoteEditorHintShown}
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
          onNote={handleCreateNote}
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
          onNote={handleEditNote}
          hasNote={notes.byHighlightId.has(activeToolbar.highlight.id)}
          onDismiss={dismissToolbar}
        />
      ) : null}
      {activeNoteEditor !== null ? (
        <AnchoredNoteEditorOverlay
          rect={activeNoteEditor.anchorRect}
          initialContent={
            notes.byHighlightId.get(activeNoteEditor.highlightId)?.content ?? ''
          }
          hintShown={props.isNoteEditorHintShown}
          onHintDismissed={props.markNoteEditorHintShown}
          onSave={(content) => {
            void notes.save(activeNoteEditor.highlightId, content);
            setActiveNoteEditor(null);
          }}
          onCancel={() => {
            setActiveNoteEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}

const EDITOR_HEIGHT_GUESS = 96;
const EDITOR_GAP = 8;

function AnchoredNoteEditorOverlay({
  rect,
  initialContent,
  hintShown,
  onHintDismissed,
  onSave,
  onCancel,
}: {
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly initialContent: string;
  readonly hintShown: boolean;
  readonly onHintDismissed: () => void;
  readonly onSave: (content: string) => void;
  readonly onCancel: () => void;
}) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const flipBelow = rect.y < EDITOR_HEIGHT_GUESS + EDITOR_GAP;
  const rawTop = flipBelow
    ? rect.y + rect.height + EDITOR_GAP
    : rect.y - EDITOR_HEIGHT_GUESS - EDITOR_GAP;
  const top = Math.max(8, Math.min(vh - EDITOR_HEIGHT_GUESS - 8, rawTop));
  const rawLeft = rect.x + rect.width / 2;
  const left = Math.max(140, Math.min(vw - 140, rawLeft));

  return (
    <div
      className="reader-workspace__note-editor-overlay"
      style={{
        position: 'fixed',
        top: `${String(top)}px`,
        left: `${String(left)}px`,
        transform: 'translateX(-50%)',
        zIndex: 1100,
      }}
    >
      <NoteEditor
        initialContent={initialContent}
        autoFocus
        hintShown={hintShown}
        onHintDismissed={onHintDismissed}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}
