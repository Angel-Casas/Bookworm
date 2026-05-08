import { useCallback, useEffect, useRef, useState } from 'react';
import type { HighlightId} from '@/domain';
import { BookId, type BookFormat, type LocationAnchor } from '@/domain';
import type { Book } from '@/domain';
import type { ProfileGenerationDeps } from '@/features/ai/prompts';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type {
  BookmarksRepository,
  ChatMessagesRepository,
  ChatThreadsRepository,
  HighlightsRepository,
  NotesRepository,
  SavedAnswersRepository,
} from '@/storage';
import type { ApiKeyState } from '@/features/ai/key/apiKeyStore';
import type { ChunkId } from '@/domain';
import type { RetrievalDeps } from '@/features/ai/retrieval/runRetrieval';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type {
  AttachedChapter,
  AttachedRetrieval,
} from '@/features/ai/chat/useChatSend';
import { resolveCurrentChapter } from '@/features/ai/prompts/resolveCurrentChapter';
import { filterAnnotationsForChapter } from '@/features/ai/prompts/filterAnnotationsForChapter';
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
import { RightRail } from './RightRail';
import { RightRailCollapsedTab } from './RightRailCollapsedTab';
import { ChatPanel } from '@/features/ai/chat/ChatPanel';
import type { AttachedPassage } from '@/features/ai/chat/useChatSend';
import { useFocusMode } from './useFocusMode';
import { useRightRailVisibility } from './useRightRailVisibility';
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
  readonly chatThreadsRepo: ChatThreadsRepository;
  readonly chatMessagesRepo: ChatMessagesRepository;
  readonly savedAnswersRepo: SavedAnswersRepository;
  readonly onOpenNotebook: () => void;
  readonly onOpenSettings: () => void;
  readonly initialRightRailVisible: boolean;
  readonly onRightRailVisibilityChange: (visible: boolean) => void;
  readonly initialChatPanelHintShown: boolean;
  readonly onChatPanelHintDismiss: () => void;
  readonly apiKeyState: ApiKeyState;
  readonly getApiKey: () => string | null;
  readonly selectedModelId: string | null;
  readonly retrievalDeps?: RetrievalDeps;
  readonly bookChunksRepo: BookChunksRepository;
  readonly bookEmbeddingsRepo: BookEmbeddingsRepository;
  readonly profileDeps?: ProfileGenerationDeps;
  readonly bookToc: Book['toc'];
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

type RailTabKey = 'contents' | 'bookmarks' | 'highlights' | 'chat';

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
  const rightRail = useRightRailVisibility({
    initial: props.initialRightRailVisible,
    onChange: props.onRightRailVisibilityChange,
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
  // Phase 4.4 passage mode. Sticky-until-dismissed across sends; cleared on
  // thread switch (handled inside ChatPanel) or via the chip's ✕.
  const [attachedPassage, setAttachedPassage] = useState<AttachedPassage | null>(null);
  // Phase 5.2 retrieval mode. One-shot per send (chip clears on send-success
  // inside useChatSend). Mutually exclusive with passage chip.
  const [attachedRetrieval, setAttachedRetrieval] = useState<AttachedRetrieval | null>(null);
  // Phase 5.4 chapter mode. Snapshot at click time, sticky across sends,
  // cleared via the chip's ✕ or by activating another attachment kind.
  const [attachedChapter, setAttachedChapter] = useState<AttachedChapter | null>(null);

  // Phase 5.4: single reducer that owns the three-way (passage/retrieval/
  // chapter) mutual-exclusion rule. All component-level setters route here
  // so the rule lives in one place and can't drift across call sites.
  type AttachmentKind = 'none' | 'passage' | 'retrieval' | 'chapter';
  const setActiveAttachment = useCallback(
    (
      kind: AttachmentKind,
      payload?: AttachedPassage | AttachedRetrieval | AttachedChapter | null,
    ): void => {
      if (kind === 'passage') {
        setAttachedPassage((payload ?? null) as AttachedPassage | null);
        setAttachedRetrieval(null);
        setAttachedChapter(null);
      } else if (kind === 'retrieval') {
        setAttachedRetrieval((payload ?? null) as AttachedRetrieval | null);
        setAttachedPassage(null);
        setAttachedChapter(null);
      } else if (kind === 'chapter') {
        setAttachedChapter((payload ?? null) as AttachedChapter | null);
        setAttachedPassage(null);
        setAttachedRetrieval(null);
      } else {
        setAttachedPassage(null);
        setAttachedRetrieval(null);
        setAttachedChapter(null);
      }
    },
    [],
  );
  // One-shot focus signal for the chat composer after Ask AI. ChatComposer
  // self-clears the flag once it has fired focus().
  const composerFocusRef = useRef<boolean>(false);
  // One-shot prefill ref drained by ChatComposer on next render — used by the
  // suggested-prompts ✎ icon. Owned here so desktop and mobile-sheet ChatPanel
  // instances share the same prefill semantics across remounts.
  const composerInitialTextRef = useRef<string | null>(null);

  // Ask-AI gate: AI is configured and a model is picked. Hidden entirely (not
  // disabled) when false — matches the spec's "no half-disabled UI" rule.
  const canAskAI =
    (props.apiKeyState.kind === 'session' || props.apiKeyState.kind === 'unlocked') &&
    props.selectedModelId !== null &&
    props.selectedModelId !== '';

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

  // Selection bridge for "Ask AI": materialize the selection as a chip,
  // expose the right rail (desktop) or open the sheet on the chat tab
  // (mobile), and queue composer focus. Toolbar dismissal is handled by
  // HighlightToolbar before this fires.
  const handleAskAI = useCallback(
    (anchor: HighlightAnchor, selectedText: string): void => {
      void (async () => {
        let extracted: {
          text: string;
          windowBefore?: string;
          windowAfter?: string;
          sectionTitle?: string;
        } = { text: '' };
        if (readerState) {
          try {
            extracted = await readerState.getPassageContextAt(anchor);
          } catch (err) {
            console.warn(
              '[passage-mode] context extraction failed; using selection only',
              err,
            );
          }
        }
        const passage: AttachedPassage = {
          anchor,
          text: extracted.text.length > 0 ? extracted.text : selectedText,
          ...(extracted.windowBefore !== undefined && {
            windowBefore: extracted.windowBefore,
          }),
          ...(extracted.windowAfter !== undefined && {
            windowAfter: extracted.windowAfter,
          }),
          ...(extracted.sectionTitle !== undefined && {
            sectionTitle: extracted.sectionTitle,
          }),
        };
        setActiveAttachment('passage', passage);
        if (viewport === 'desktop') {
          if (!rightRail.visible) rightRail.set(true);
        } else {
          setActiveSheet('toc');
          setActiveRailTab('chat');
        }
        composerFocusRef.current = true;
      })();
    },
    [readerState, rightRail, viewport, setActiveAttachment],
  );

  const handleClearAttachedPassage = useCallback((): void => {
    setActiveAttachment('none');
  }, [setActiveAttachment]);

  const handleToggleSearch = useCallback((): void => {
    if (attachedRetrieval !== null) {
      setActiveAttachment('none');
    } else {
      setActiveAttachment('retrieval', { bookId: BookId(props.bookId) });
    }
  }, [attachedRetrieval, props.bookId, setActiveAttachment]);

  const handleClearAttachedRetrieval = useCallback((): void => {
    setActiveAttachment('none');
  }, [setActiveAttachment]);

  // Phase 5.4: derive the chapter snapshot on demand at click time. We
  // don't pre-resolve on every render to avoid eager IDB reads; the
  // 'attachable' boolean below is a synchronous best-effort signal for
  // the toolbar button's disabled state.
  const buildChapterSnapshot =
    useCallback(async (): Promise<AttachedChapter | null> => {
      if (readerState === null) return null;
      const allChunks = await props.bookChunksRepo.listByBook(BookId(props.bookId));
      const resolved = resolveCurrentChapter(
        readerState.currentEntryId,
        allChunks,
        readerState.toc ?? [],
      );
      if (resolved === null) return null;
      // Notes hook exposes a Map<HighlightId, Note> rather than a flat list;
      // unwrap the Map values for the filter helper, which is list-shaped.
      const allNotes = Array.from(notes.byHighlightId.values());
      const annotations = filterAnnotationsForChapter(
        highlights.list,
        allNotes,
        resolved.sectionTitle,
      );
      return {
        sectionId: resolved.sectionId,
        sectionTitle: resolved.sectionTitle,
        chunks: resolved.chunks,
        highlights: annotations.highlights,
        notes: annotations.notes,
      };
    }, [readerState, props.bookChunksRepo, props.bookId, highlights.list, notes.byHighlightId]);

  const chapterAttachable = readerState?.currentEntryId !== undefined;

  const handleToggleChapter = useCallback((): void => {
    void (async () => {
      if (attachedChapter !== null) {
        setActiveAttachment('none');
        return;
      }
      const snapshot = await buildChapterSnapshot();
      if (snapshot === null) return;
      setActiveAttachment('chapter', snapshot);
    })();
  }, [attachedChapter, buildChapterSnapshot, setActiveAttachment]);

  const handleClearAttachedChapter = useCallback((): void => {
    setActiveAttachment('none');
  }, [setActiveAttachment]);

  const resolveChunkAnchor = useCallback(
    async (chunkId: ChunkId): Promise<LocationAnchor | null> => {
      const allChunks = await props.bookChunksRepo.listByBook(BookId(props.bookId));
      const c = allChunks.find((x) => x.id === chunkId);
      return c !== undefined ? c.locationAnchor : null;
    },
    [props.bookChunksRepo, props.bookId],
  );

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
  const showRightRail = isDesktop && focus.mode === 'normal' && rightRail.visible;
  const showRightRailEdgeTab = isDesktop && focus.mode === 'normal' && !rightRail.visible;

  const sheetTabs: readonly SheetTab[] = [
    { key: 'contents', label: 'Contents' },
    { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
    { key: 'highlights', label: 'Highlights', badge: highlights.list.length },
    { key: 'chat', label: 'Chat' },
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
          onOpenNotebook={props.onOpenNotebook}
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
        {showRightRail ? (
          <RightRail
            title="Chat"
            onCollapse={() => {
              rightRail.set(false);
            }}
          >
            <ChatPanel
              bookId={props.bookId}
              book={{
                title: props.bookTitle,
                ...(props.bookSubtitle !== undefined && { author: props.bookSubtitle }),
                format: props.bookFormat,
                toc: props.bookToc,
              }}
              apiKeyState={props.apiKeyState}
              getApiKey={props.getApiKey}
              selectedModelId={props.selectedModelId}
              threadsRepo={props.chatThreadsRepo}
              messagesRepo={props.chatMessagesRepo}
              savedAnswersRepo={props.savedAnswersRepo}
              onOpenSettings={props.onOpenSettings}
              hintShown={props.initialChatPanelHintShown}
              onHintDismiss={props.onChatPanelHintDismiss}
              attachedPassage={attachedPassage}
              onClearAttachedPassage={handleClearAttachedPassage}
              attachedRetrieval={attachedRetrieval}
              onClearAttachedRetrieval={handleClearAttachedRetrieval}
              onToggleSearch={handleToggleSearch}
              attachedChapter={attachedChapter}
              onClearAttachedChapter={handleClearAttachedChapter}
              onToggleChapter={handleToggleChapter}
              chapterAttached={attachedChapter !== null}
              chapterAttachable={chapterAttachable}
              {...(props.retrievalDeps !== undefined && {
                retrievalDeps: props.retrievalDeps,
              })}
              {...(props.profileDeps !== undefined && {
                profileDeps: props.profileDeps,
              })}
              resolveChunkAnchor={resolveChunkAnchor}
              onJumpToReaderAnchor={(anchor) => {
                if (!readerState) return;
                const target: LocationAnchor =
                  anchor.kind === 'epub-cfi'
                    ? { kind: 'epub-cfi', cfi: anchor.cfi }
                    : { kind: 'pdf', page: anchor.page };
                readerState.goToAnchor(target);
              }}
              composerFocusRef={composerFocusRef}
              composerInitialTextRef={composerInitialTextRef}
            />
          </RightRail>
        ) : null}
        {showRightRailEdgeTab ? (
          <RightRailCollapsedTab
            onExpand={() => {
              rightRail.set(true);
            }}
          />
        ) : null}
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
            />
          ) : null}
          {activeRailTab === 'chat' ? (
            <ChatPanel
              bookId={props.bookId}
              book={{
                title: props.bookTitle,
                ...(props.bookSubtitle !== undefined && { author: props.bookSubtitle }),
                format: props.bookFormat,
                toc: props.bookToc,
              }}
              apiKeyState={props.apiKeyState}
              getApiKey={props.getApiKey}
              selectedModelId={props.selectedModelId}
              threadsRepo={props.chatThreadsRepo}
              messagesRepo={props.chatMessagesRepo}
              savedAnswersRepo={props.savedAnswersRepo}
              onOpenSettings={props.onOpenSettings}
              onCollapse={() => {
                setActiveSheet(null);
              }}
              hintShown={props.initialChatPanelHintShown}
              onHintDismiss={props.onChatPanelHintDismiss}
              attachedPassage={attachedPassage}
              onClearAttachedPassage={handleClearAttachedPassage}
              attachedRetrieval={attachedRetrieval}
              onClearAttachedRetrieval={handleClearAttachedRetrieval}
              onToggleSearch={handleToggleSearch}
              attachedChapter={attachedChapter}
              onClearAttachedChapter={handleClearAttachedChapter}
              onToggleChapter={handleToggleChapter}
              chapterAttached={attachedChapter !== null}
              chapterAttachable={chapterAttachable}
              {...(props.retrievalDeps !== undefined && {
                retrievalDeps: props.retrievalDeps,
              })}
              {...(props.profileDeps !== undefined && {
                profileDeps: props.profileDeps,
              })}
              resolveChunkAnchor={resolveChunkAnchor}
              onJumpToReaderAnchor={(anchor) => {
                if (!readerState) return;
                const target: LocationAnchor =
                  anchor.kind === 'epub-cfi'
                    ? { kind: 'epub-cfi', cfi: anchor.cfi }
                    : { kind: 'pdf', page: anchor.page };
                readerState.goToAnchor(target);
                setActiveSheet(null);
              }}
              composerFocusRef={composerFocusRef}
              composerInitialTextRef={composerInitialTextRef}
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
          {...(canAskAI && {
            canAskAI: true,
            onAskAI: () => {
              handleAskAI(activeToolbar.anchor, activeToolbar.selectedText);
            },
          })}
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
          {...(canAskAI && {
            canAskAI: true,
            onAskAI: () => {
              handleAskAI(
                activeToolbar.highlight.anchor,
                activeToolbar.highlight.selectedText,
              );
            },
          })}
        />
      ) : null}
      {activeNoteEditor !== null ? (
        <AnchoredNoteEditorOverlay
          key={activeNoteEditor.highlightId}
          rect={activeNoteEditor.anchorRect}
          initialContent={
            notes.byHighlightId.get(activeNoteEditor.highlightId)?.content ?? ''
          }
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
// Half-width assumed for clamping. The note-editor's max-width is 420px;
// when the actual content is narrower the overlay will visually appear
// further from the rails than necessary, but it stays inside the
// reader-area which is the safety property we want.
const EDITOR_HALF_WIDTH_GUESS = 210;

function AnchoredNoteEditorOverlay({
  rect,
  initialContent,
  onSave,
  onCancel,
}: {
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly initialContent: string;
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
  // Compute the horizontal range the overlay can occupy without covering the
  // desktop rail (left, when present) or the right rail (when present). The
  // overlay uses translateX(-50%), so its center must sit at least half its
  // width away from each forbidden edge. Without this, a selection at the
  // first paginated column lands the overlay over the desktop-rail tabs and
  // swallows clicks meant for navigation.
  const desktopRail =
    typeof document !== 'undefined' ? document.querySelector('aside.desktop-rail') : null;
  const rightRail =
    typeof document !== 'undefined' ? document.querySelector('aside.right-rail') : null;
  const leftEdge = desktopRail
    ? desktopRail.getBoundingClientRect().right + EDITOR_GAP
    : 8;
  const rightEdge = rightRail
    ? rightRail.getBoundingClientRect().left - EDITOR_GAP
    : vw - 8;
  const minLeft = leftEdge + EDITOR_HALF_WIDTH_GUESS;
  const maxLeft = rightEdge - EDITOR_HALF_WIDTH_GUESS;
  const rawLeft = rect.x + rect.width / 2;
  // When the available reader area is too narrow to host the editor without
  // overlap (minLeft > maxLeft), prefer the left edge — overlapping the right
  // rail is the smaller UX harm than covering the rail tabs that drive
  // navigation, and the right rail can be collapsed by the user.
  const left = minLeft > maxLeft ? minLeft : Math.max(minLeft, Math.min(maxLeft, rawLeft));

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
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the overlay opens in response to a user action (toolbar 📝); focusing the textarea is the desired outcome
        autoFocus
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}
