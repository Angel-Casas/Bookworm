# Phase 2.3 — Reader Workspace Layout (Design)

**Date:** 2026-05-03
**Phase:** 2 — Reading core, Task 2.3
**Branch:** `phase-2-3-reader-workspace`
**Status:** approved (pending implementation plan)

---

## 1. Purpose

Replace the minimal reader shell from Phase 2.1 / 2.2 with a proper reader workspace: TOC moves from a popover sheet into a permanent left rail on desktop, mobile gets a bottom-sheet pattern matching design-system intent, and a focus mode hides chrome + rail for true immersive reading. Also resolves the App.tsx growth debt accumulated through Phases 2.1–2.2 by extracting reader-host concerns into dedicated hooks.

## 2. Scope

In scope (Task 2.3 acceptance criteria from `docs/04-implementation-roadmap.md`):

- Desktop multi-pane layout (see decision Q1 for the v2.3 deviation from "three-pane")
- Mobile sheet layout
- Focus mode
- Reader remains center stage
- Panel layout responsive and stable
- Mobile layout feels intentional, not compressed desktop UI

In scope (deferred-from-prior-phases debt):

- App.tsx extraction (`useAppView`, `useReaderHost`)
- ReaderView slim-down (`onStateChange` API; sheet rendering moves up to workspace)

Explicitly out of scope:

- Right rail (Phase 3 lands annotations into it; no point shipping a placeholder pane)
- Drag-resizable rail / drag-resizable bottom sheet (Phase 6 polish)
- Touch-swipe gestures (Phase 6 polish)
- Hover-cursor auto-hide in focus mode (Phase 6 polish)

## 3. Decisions locked in (from brainstorm)

| # | Decision | Choice | Reason |
|---|---|---|---|
| Q1 | What fills the rails in v2.3 | **Two-pane** — left rail (TOC) + reader; right rail deferred to Phase 3 | Right rail without annotations or AI is dead chrome — exactly what the design system prohibits; ships with rails-feel-purposeful from day one |
| Q2 | Mobile sheet pattern | **Bottom sheet (iOS Books style)** with drag handle and scrim | Matches design system "slide-up sheets"; reader stays partially visible (spatial continuity); standard pattern users recognize |
| Q3 | Focus mode trigger + persistence | **Toggle button + keyboard shortcut + global persistence; chrome hidden in focus mode** | User refinement: focus mode hides the entire chrome (not just the rail) for true immersion; toggle persists in `readerPreferences` |
| Q4 | Exit-focus affordance when chrome hidden | **Keyboard + hover-reveal at top edge** | Best balance of immersion and discoverability; matches video player convention; first-time hint prevents getting stuck |
| Q5 | App.tsx extraction | **Targeted: `useReaderHost` + `useAppView` + new `ReaderWorkspace`** | We're touching App.tsx anyway; clean three-jobs-in-one-file → three single-purpose modules; ages well into Phase 3 |

## 4. Architecture

### 4.1 Module layout

```
src/
├─ app/
│   ├─ App.tsx                       # MODIFIED — slim composition root (~150 lines)
│   ├─ useAppView.ts                 # NEW — view state + persistence + deleted-book guard
│   ├─ useReaderHost.ts              # NEW — reader-specific callbacks; library callbacks too
│   └─ view.ts                       # unchanged from 2.1
├─ features/reader/
│   ├─ workspace/
│   │   ├─ ReaderWorkspace.tsx       # NEW — top-level workspace shell
│   │   ├─ ReaderWorkspace.test.tsx
│   │   ├─ DesktopRail.tsx           # NEW — left rail (TOC) on desktop
│   │   ├─ DesktopRail.test.tsx
│   │   ├─ MobileSheet.tsx           # NEW — bottom-sheet wrapper with scrim + handle
│   │   ├─ MobileSheet.test.tsx
│   │   ├─ useFocusMode.ts           # NEW — focus state, keyboard shortcut, hover reveal
│   │   ├─ useFocusMode.test.ts
│   │   ├─ useViewport.ts            # NEW — matchMedia hook ('desktop' | 'mobile')
│   │   ├─ useViewport.test.ts
│   │   ├─ workspace.css
│   │   ├─ desktop-rail.css
│   │   └─ mobile-sheet.css
│   ├─ ReaderView.tsx                # MODIFIED — slim; exposes state via onStateChange
│   ├─ ReaderChrome.tsx              # MODIFIED — gains focus-toggle; hides ☰ on desktop
│   ├─ TocPanel.tsx                  # unchanged from 2.1
│   ├─ TypographyPanel.tsx           # unchanged from 2.2
│   └─ readerMachine.ts              # unchanged from 2.1
└─ ...
```

### 4.2 Boundary intent

- **`ReaderWorkspace`** owns the workspace-level state (focus mode, which sheet is open) and the layout decision (rail vs sheet vs focused-fullscreen). It composes `ReaderChrome` + `DesktopRail`/`MobileSheet` + `ReaderView`.
- **`ReaderView`** keeps adapter lifecycle, the mount-host div, location-change/save wiring, and theme `data-theme` application. It surfaces TOC + current-anchor + prefs to `ReaderWorkspace` through `onStateChange`.
- **`useFocusMode`** is the focus mode state machine: `'normal' | 'focus'`, keyboard shortcut binding, hover-reveal chrome state, first-time hint orchestration, persistence-callback wiring.
- **`useViewport`** is a small `matchMedia('(min-width: 768px)')` hook; returns `'desktop' | 'mobile'`.
- **`useReaderHost`** owns the reader-specific callbacks plus library callbacks that touch wiring. Returns the props bundle for both `ReaderWorkspace` and `LibraryView`.
- **`useAppView`** owns view state + persistence + the deleted-book-fallback guard.

### 4.3 Where state lives

| State | Owned by | Persisted? |
|---|---|---|
| `view` (library/reader) | `useAppView` | settings.view (existing) |
| Focus mode (`'normal'` / `'focus'`) | `useFocusMode` | NEW field `readerPreferences.focusMode` |
| Chrome visibility (during hover-reveal) | `useFocusMode` (transient) | not persisted |
| Active sheet (TOC/typography open) on mobile | `ReaderWorkspace` | not persisted |
| First-time-hint shown | settings (NEW key `focusModeHintShown`) | yes |
| Reading position, prefs, etc. | unchanged from 2.1/2.2 | unchanged |

### 4.4 Migration

Adding `focusMode` to `ReaderPreferences` follows the same forward-compat pattern as 2.2's `modeByFormat.pdf`: the validator's `normalize` step fills in `'normal'` when missing. No IDB schema bump.

Adding `focusModeHintShown` to settings is just a new key in the existing key-value `settings` store; no migration needed.

### 4.5 Responsive breakpoint

Single breakpoint at **768px**. Below = mobile pattern (no rail, sheets); at-or-above = desktop pattern (rail visible by default, focus toggle, hover-reveal chrome). Window resize on desktop adapts live; opening the reader on a tablet between portrait/landscape just switches modes.

## 5. Workspace component shape + focus mode mechanics

### 5.1 `ReaderWorkspace` props + composition

```tsx
type ReaderWorkspaceProps = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly bookFormat: BookFormat;
  readonly onBack: () => void;
  readonly loadBookForReader: ReaderViewProps['loadBookForReader'];
  readonly createAdapter: ReaderViewProps['createAdapter'];
  readonly onAnchorChange: ReaderViewProps['onAnchorChange'];
  readonly onPreferencesChange: ReaderViewProps['onPreferencesChange'];
  readonly initialFocusMode: FocusMode;
  readonly onFocusModeChange: (mode: FocusMode) => void;
};

function ReaderWorkspace(props) {
  const viewport = useViewport();                                       // 'desktop' | 'mobile'
  const focus = useFocusMode({
    initial: props.initialFocusMode,
    onChange: props.onFocusModeChange,
  });
  const [activeSheet, setActiveSheet] = useState<'toc' | 'typography' | null>(null);
  const [readerState, setReaderState] = useState<ReaderViewExposedState | null>(null);

  return (
    <div className="reader-workspace" data-mode={focus.mode} data-viewport={viewport}>
      {focus.shouldRenderChrome && (
        <ReaderChrome
          {...chromeProps}
          showFocusToggle={viewport === 'desktop'}
          showTocButton={viewport === 'mobile'}
          showSettingsButton={true}
          onToggleFocus={focus.toggle}
          onOpenToc={() => setActiveSheet('toc')}
          onOpenSettings={() => setActiveSheet('typography')}
        />
      )}

      <div className="reader-workspace__body">
        {viewport === 'desktop' && focus.mode === 'normal' && readerState?.toc && (
          <DesktopRail
            toc={readerState.toc}
            currentEntryId={readerState.currentEntryId}
            onSelect={(entry) => readerState.goToAnchor(entry.anchor)}
          />
        )}
        <ReaderView
          {...viewProps}
          onStateChange={setReaderState}
        />
      </div>

      {viewport === 'mobile' && activeSheet === 'toc' && readerState?.toc && (
        <MobileSheet onDismiss={() => setActiveSheet(null)}>
          <TocPanel
            toc={readerState.toc}
            currentEntryId={readerState.currentEntryId}
            onSelect={(entry) => {
              readerState.goToAnchor(entry.anchor);
              setActiveSheet(null);
            }}
          />
        </MobileSheet>
      )}
      {viewport === 'mobile' && activeSheet === 'typography' && readerState?.prefs && (
        <MobileSheet onDismiss={() => setActiveSheet(null)}>
          <TypographyPanel
            preferences={readerState.prefs}
            bookFormat={props.bookFormat}
            onChange={readerState.applyPreferences}
          />
        </MobileSheet>
      )}

      {focus.firstTimeHintVisible && <FocusFirstTimeHint />}
    </div>
  );
}
```

### 5.2 `ReaderView` API change — `onStateChange`

`ReaderView` exposes its current state to the workspace through a new optional `onStateChange?: (state: ReaderViewExposedState) => void` prop:

```ts
type ReaderViewExposedState = {
  toc: readonly TocEntry[] | null;
  currentEntryId: string | undefined;
  prefs: ReaderPreferences | null;
  goToAnchor: (anchor: LocationAnchor) => void;
  applyPreferences: (prefs: ReaderPreferences) => void;
};
```

This is a deliberate small leak of internals — necessary to let `ReaderWorkspace` render TOC into the rail (desktop) or a sheet (mobile) while `ReaderView` keeps owning the adapter. Alternative (context) is heavier for a single consumer relationship.

### 5.3 `useFocusMode` mechanics

Implementation outline:

```ts
function useFocusMode({ initial, onChange }) {
  const [mode, setMode] = useState(initial);              // 'normal' | 'focus'
  const [isChromeRevealed, setIsChromeRevealed] = useState(false);
  const [firstTimeHintVisible, setFirstTimeHintVisible] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLElement && (
        e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable
      );
      if (isInput) return;
      if (e.key === 'F' && !e.metaKey && !e.ctrlKey) toggle();
      if (e.key === 'Escape' && mode === 'focus') toggle();
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Hover-reveal: only when mode === 'focus'
  useEffect(() => {
    if (mode !== 'focus') return;
    let hideTimer: number | undefined;
    const onMove = (e: MouseEvent) => {
      const inHoverZone = e.clientY <= 40;
      if (inHoverZone) {
        setIsChromeRevealed(true);
        if (hideTimer) clearTimeout(hideTimer);
      } else {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => setIsChromeRevealed(false), 1500);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [mode]);

  return {
    mode,
    shouldRenderChrome: mode === 'normal' || isChromeRevealed,
    toggle: ...,                    // flips mode + persists + first-time hint orchestration
    firstTimeHintVisible,
  };
}
```

### 5.4 Hover-reveal details

- **Hover zone**: top 40px of viewport
- **Reveal**: chrome fades in over 200ms (CSS transition)
- **Hide delay**: 1500ms after cursor leaves the hover zone
- **Cancellation**: cursor returning to the zone cancels a pending hide
- **Reduced-motion**: respects `prefers-reduced-motion: reduce` (no fade — instant show/hide)

### 5.5 First-time hint copy

Shown the very first time the user enters focus mode, then never again (tracked via `settings.focusModeHintShown`):

> Move the cursor to the top to bring the menu back · F or Esc to exit

Fades in with chrome, fades out after 4 seconds.

### 5.6 `MobileSheet` mechanics

```tsx
function MobileSheet({ onDismiss, children }) {
  // Escape key dismisses (only bound when sheet is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <>
      <div className="mobile-sheet__scrim" onClick={onDismiss} aria-hidden="true" />
      <div className="mobile-sheet" role="dialog" aria-modal="true">
        <div className="mobile-sheet__handle" />
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </>
  );
}
```

- **Scrim**: dim layer below the sheet; tap-to-dismiss
- **Sheet**: 60vh height, slides up from bottom (CSS transform)
- **Handle**: visual affordance only in v2.3 (drag-to-resize is Phase 6)
- **Reduced-motion**: respects (no slide animation, just opacity)

### 5.7 `useViewport` mechanics

```ts
function useViewport(): 'desktop' | 'mobile' {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
      ? 'desktop'
      : 'mobile'
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => setViewport(mq.matches ? 'desktop' : 'mobile');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return viewport;
}
```

## 6. App.tsx extraction + data flow

### 6.1 `App.tsx` after extraction (~150 lines)

```tsx
export function App() {
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  // existing boot effect, unchanged

  if (boot.kind === 'loading') return <LoadingShell />;
  if (boot.kind === 'error') return <LibraryBootError reason={boot.reason} />;
  return <ReadyApp boot={boot} />;
}

function ReadyApp({ boot }) {
  const view = useAppView({ settingsRepo: boot.wiring.settingsRepo, libraryStore: boot.libraryStore, initial: boot.initialView });
  const reader = useReaderHost({ wiring: boot.wiring, libraryStore: boot.libraryStore, view });
  // ... cover cache pagehide cleanup (existing) ...

  if (view.current.kind === 'reader') {
    const book = reader.findBook(view.current.bookId);
    if (!book) return null;
    return (
      <div className="app">
        <ReaderWorkspace
          key={view.current.bookId}
          bookId={view.current.bookId}
          bookTitle={book.title}
          bookFormat={book.format}
          {...(book.author !== undefined && { bookSubtitle: book.author })}
          onBack={view.goLibrary}
          loadBookForReader={reader.loadBookForReader}
          createAdapter={reader.createAdapter}
          onAnchorChange={reader.onAnchorChange}
          onPreferencesChange={reader.onPreferencesChange}
          initialFocusMode={reader.initialFocusMode}
          onFocusModeChange={reader.onFocusModeChange}
        />
      </div>
    );
  }
  return (
    <div className="app">
      <LibraryView ... onOpenBook={view.goReader} />
      <DropOverlay onFilesDropped={reader.onFilesPicked} />
    </div>
  );
}
```

### 6.2 `useAppView` hook

```ts
function useAppView({ settingsRepo, libraryStore, initial }): AppViewHandle {
  const [view, setViewState] = useState<AppView>(() => {
    if (initial.kind === 'reader' && !findBook(libraryStore, initial.bookId)) {
      return LIBRARY_VIEW;
    }
    return initial;
  });

  const setView = useCallback((next: AppView) => {
    setViewState(next);
    void settingsRepo.setView(next);
  }, [settingsRepo]);

  // Guard: book deleted mid-session
  useEffect(() => {
    if (view.kind === 'reader' && !findBook(libraryStore, view.bookId)) {
      setView(LIBRARY_VIEW);
    }
  }, [view, libraryStore, setView]);

  return {
    current: view,
    goLibrary: useCallback(() => setView(LIBRARY_VIEW), [setView]),
    goReader: useCallback((book: Book) => setView(readerView(book.id)), [setView]),
  };
}
```

### 6.3 `useReaderHost` hook

```ts
function useReaderHost({ wiring, libraryStore, view }): ReaderHostHandle {
  const [initialFocusMode, setInitialFocusMode] = useState<FocusMode>('normal');
  useEffect(() => {
    void wiring.readerPreferencesRepo.get().then(p => setInitialFocusMode(p.focusMode));
  }, [wiring]);

  const loadBookForReader = useCallback(async (bookId: string) => {
    const book = await wiring.bookRepo.getById(BookId(bookId));
    if (book?.source.kind !== 'imported-file') throw new Error(`Book ${bookId} missing or has no source`);
    const blob = await wiring.opfs.readFile(book.source.opfsPath);
    if (!blob) throw new Error(`Book ${bookId} blob missing from OPFS`);
    const preferences = await wiring.readerPreferencesRepo.get();
    const initialAnchor = await wiring.readingProgressRepo.get(bookId);
    return initialAnchor ? { blob, preferences, initialAnchor } : { blob, preferences };
  }, [wiring]);

  const createAdapter = useCallback((host: HTMLElement, format: BookFormat): BookReader => {
    return format === 'pdf' ? new PdfReaderAdapter(host) : new EpubReaderAdapter(host);
  }, []);

  const onAnchorChange = useCallback((bookId, anchor) => {
    void wiring.readingProgressRepo.put(bookId, anchor);
  }, [wiring]);

  const onPreferencesChange = useCallback((prefs) => {
    void wiring.readerPreferencesRepo.put(prefs);
  }, [wiring]);

  const onFocusModeChange = useCallback(async (mode: FocusMode) => {
    const current = await wiring.readerPreferencesRepo.get();
    void wiring.readerPreferencesRepo.put({ ...current, focusMode: mode });
  }, [wiring]);

  // Library callbacks (also reader-host because they touch wiring)
  const onFilesPicked = useCallback((files) => { /* existing */ }, [wiring, /* ... */]);
  const onPersistSort = useMemo(() => debounce((key) => void wiring.settingsRepo.setLibrarySort(key), 200), [wiring]);
  const onRemoveBook = useCallback(async (book) => { /* existing remove flow + view fallback */ }, [wiring, libraryStore, view]);

  const findBook = useCallback((bookId) => libraryStore.getState().books.find(b => b.id === bookId), [libraryStore]);

  return {
    loadBookForReader, createAdapter, onAnchorChange, onPreferencesChange,
    initialFocusMode, onFocusModeChange,
    onFilesPicked, onPersistSort, onRemoveBook, findBook,
  };
}
```

### 6.4 `ReaderPreferences` shape gains `focusMode`

```ts
export type FocusMode = 'normal' | 'focus';

export type ReaderPreferences = {
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly modeByFormat: { readonly epub: ReaderMode; readonly pdf: ReaderMode };
  readonly focusMode: FocusMode;                                // ← NEW
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  // ...existing...
  focusMode: 'normal',
};
```

`readerPreferencesRepo.normalize()` fills missing `focusMode` with `'normal'` — same forward-compat pattern as 2.2's `modeByFormat.pdf`. No IDB schema bump.

### 6.5 End-to-end data flow (open book → focus mode → reload)

```
1. User clicks book on bookshelf (desktop)
       ↓
   useAppView.goReader(book) → setView(reader) → settingsRepo.setView()
       ↓
2. ReadyApp re-renders → ReaderWorkspace mounts (key=bookId)
       ↓
   useFocusMode initializes with initialFocusMode (read by useReaderHost at boot)
   useViewport returns 'desktop'
   ReaderWorkspace renders chrome + DesktopRail (because mode='normal') + ReaderView
       ↓
   ReaderView (unchanged from 2.2): readerMachine loads, opens adapter,
   surfaces toc/prefs to ReaderWorkspace via onStateChange
       ↓
   ReaderWorkspace receives state, passes toc to DesktopRail
       ↓
3. User presses F (or clicks focus toggle in chrome)
       ↓
   useFocusMode.toggle() → mode='focus' → onFocusModeChange('focus')
   → readerPreferencesRepo.put()
       ↓
   ReaderWorkspace re-renders: chrome hidden, DesktopRail hidden,
   ReaderView fills the workspace
       ↓
   First-time hint fades in for 4s; settings.focusModeHintShown=true persisted
       ↓
4. User moves cursor to top 40px of viewport
       ↓
   useFocusMode.shouldRenderChrome=true → chrome fades in (CSS transition)
       ↓
   User moves cursor away → 1.5s timer → chrome fades out
       ↓
5. User reloads
       ↓
   App.tsx boots → reads settings.view → still 'reader'
       ↓
   useReaderHost reads readerPreferences.focusMode='focus' from boot effect
       ↓
   ReaderWorkspace mounts → useFocusMode reads initialFocusMode='focus'
   → renders fullscreen reader from first paint (no chrome flash)
```

### 6.6 Three implementation choices baked in

1. **`initialFocusMode` is a synchronous prop**, read by `useReaderHost`'s boot effect. This avoids any flash of chrome on reload when focus mode is persisted as `'focus'`.
2. **Mode-change persistence is async-fire-and-forget** (`void readerPreferencesRepo.put(...)`). UI updates immediately; persistence trails by < 50ms.
3. **`MobileSheet` Escape listener is bound only when the sheet is open.** No global keyboard handler hijacking Escape when no sheet is mounted (Escape may also exit focus mode in `useFocusMode`).

## 7. Error handling & edge cases

| Case | Handling |
|---|---|
| Book deleted while in reader (multi-tab) | `useAppView` guard effect detects missing book on next render, falls back to library |
| User in focus mode resizes window below 768px | `useViewport` flips to mobile; `MobileSheet` becomes available; focus mode is desktop-only so chrome reappears (focus mode visually doesn't apply on mobile — chrome and sheets are the affordance) |
| Cursor leaves browser window during hover-reveal | Standard `mousemove` cleanup; chrome auto-hides after 1.5s without movement |
| Window blurs during focus mode | Focus mode persists (intentional — coming back, user is still in the same context) |
| User opens TypographyPanel sheet on mobile, then changes window size to desktop | Sheet renders briefly then unmounts as `viewport === 'desktop'`; preferences they changed are saved; cleanup is graceful |
| Reduced-motion user enters focus mode | Hover-reveal still works but with no fade animation (instant show/hide); first-time hint also instant |

## 8. Testing strategy

### 8.1 Unit (Vitest)

| File under test | What it verifies |
|---|---|
| `domain/reader/types.ts` | `DEFAULT_READER_PREFERENCES.focusMode === 'normal'` |
| `readerPreferences.ts` (modified) | Existing tests still pass; v2.2-shape record (no `focusMode`) loads cleanly with synthesized `'normal'`; corrupted `focusMode` value normalizes to `'normal'` |
| `useAppView.test.ts` | Initial view from settings respected; deleted-book guard falls back to library; `goReader`/`goLibrary` persist via `settingsRepo.setView` |
| `useReaderHost.test.ts` | Callbacks return correct shapes; `loadBookForReader` rejects on missing blob; `onFocusModeChange` writes to repo |
| `useFocusMode.test.ts` | Initial mode honored; toggle flips state + fires `onChange`; `F` key toggles; `Escape` only exits focus (doesn't enter); shortcuts ignored when input/textarea focused; first-time hint shows once then never again |
| `useViewport.test.ts` | Initial value matches `matchMedia` query; `change` event updates state; cleanup removes listener |
| `MobileSheet.test.tsx` | Renders sheet + scrim; scrim click fires `onDismiss`; Escape key fires `onDismiss`; `role='dialog'` + `aria-modal='true'` set |
| `DesktopRail.test.tsx` | Renders TOC entries; click forwards to `onSelect`; current entry highlighted; empty TOC shows the same message as `TocPanel` |
| `ReaderWorkspace.test.tsx` | Desktop + `mode='normal'`: chrome + rail + reader rendered. Desktop + `mode='focus'`: chrome hidden, rail hidden, reader fills. Mobile: rail not rendered; opening a sheet renders `MobileSheet`. `onStateChange` from ReaderView surfaces TOC into rail/sheet correctly. |

### 8.2 E2E (Playwright)

| Spec | Scenario |
|---|---|
| `e2e/reader-workspace-desktop.spec.ts` | Import EPUB → open → desktop viewport → rail visible with TOC → click TOC entry navigates → press `F` → chrome + rail hidden → reader fills viewport → move mouse to top → chrome fades in → move away → chrome fades out → press `Esc` → exits focus mode |
| `e2e/reader-workspace-mobile.spec.ts` | Mobile viewport (390×844) → import + open → rail NOT visible → tap ☰ → bottom sheet slides up with TOC → tap scrim → sheet dismisses → tap ⚙ → typography sheet appears |
| `e2e/reader-focus-persists.spec.ts` | Desktop → enter focus mode → reload → reader is still in focus mode on first paint (no chrome flash) |
| `e2e/reader-workspace-resize.spec.ts` | Desktop viewport → rail visible → resize to mobile width → rail disappears, mobile sheet trigger usable → resize back → rail returns |

### 8.3 Acceptance criteria → coverage map

| Acceptance criterion | Covered by |
|---|---|
| Desktop multi-pane layout (Q1: two-pane in v2.3) | `ReaderWorkspace.test.tsx` + `e2e/reader-workspace-desktop.spec.ts` |
| Mobile sheet layout | `MobileSheet.test.tsx` + `e2e/reader-workspace-mobile.spec.ts` |
| Focus mode | `useFocusMode.test.ts` + `e2e/reader-workspace-desktop.spec.ts` + `e2e/reader-focus-persists.spec.ts` |
| Reader remains center stage | `ReaderWorkspace.test.tsx` (rail + reader → reader is dominant in flex layout) |
| Panel layout responsive and stable | `e2e/reader-workspace-resize.spec.ts` |
| Mobile layout feels intentional, not compressed desktop | Manual smoke + `MobileSheet.test.tsx` (verifies bottom-sheet pattern) |

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `ReaderView` API change (`onStateChange`) is a leak of internals; if Phase 3 adds annotation state, it bloats | Med | Type the exposed state explicitly (`ReaderViewExposedState`); document as the workspace ↔ view boundary; Phase 3 may extend but keep small |
| Focus-mode hover-reveal is finicky (timer races, cursor jumps) | Med | Standard `mousemove` + debounce pattern; e2e asserts visible/hidden states; edge cases (cursor leaves window) handled via `mouseleave` on `window` |
| Initial focus-mode prop must be loaded synchronously to avoid chrome flash | Med | `useReaderHost` reads `readerPreferences.focusMode` once at boot; passes to ReaderWorkspace as a synchronous prop; e2e test asserts no chrome flash |
| Window resize spamming `useViewport` causes unnecessary re-renders | Low | `matchMedia` only fires on breakpoint crossing, not every pixel |
| `ReaderView` API change breaks Phase 2.1/2.2 test suite | Med | `ReaderView`'s public prop API stays compatible; `onStateChange` is optional. Existing tests don't pass it — they keep working. |
| App.tsx extraction breaks existing flows in subtle ways | Med | Keep behavior identical; extraction is mechanical (move callbacks into hooks; pass results down). Existing e2e suite (Phase 1 + 2.1 + 2.2) is the regression net — must stay green. |
| First-time hint storage in `settings` (not `readerPreferences`) creates a tiny new key | Low | Adds `settings.focusModeHintShown: boolean`; one-time write; no migration |
| Hover-reveal interferes with selection at the top of the page | Low | Hover zone is only chrome's height (~40px above the reader); selecting reader text doesn't trigger reveal |

## 10. Files

### 10.1 New (~21 files)

```
src/app/useAppView.ts
src/app/useAppView.test.ts
src/app/useReaderHost.ts
src/app/useReaderHost.test.ts
src/features/reader/workspace/ReaderWorkspace.tsx
src/features/reader/workspace/ReaderWorkspace.test.tsx
src/features/reader/workspace/DesktopRail.tsx
src/features/reader/workspace/DesktopRail.test.tsx
src/features/reader/workspace/MobileSheet.tsx
src/features/reader/workspace/MobileSheet.test.tsx
src/features/reader/workspace/useFocusMode.ts
src/features/reader/workspace/useFocusMode.test.ts
src/features/reader/workspace/useViewport.ts
src/features/reader/workspace/useViewport.test.ts
src/features/reader/workspace/workspace.css
src/features/reader/workspace/desktop-rail.css
src/features/reader/workspace/mobile-sheet.css
e2e/reader-workspace-desktop.spec.ts
e2e/reader-workspace-mobile.spec.ts
e2e/reader-focus-persists.spec.ts
e2e/reader-workspace-resize.spec.ts
```

### 10.2 Modified

```
src/app/App.tsx                                     — slim; uses useAppView + useReaderHost
src/domain/reader/types.ts                          — add focusMode + FocusMode + default
src/storage/repositories/readerPreferences.ts       — normalize fills missing focusMode
src/storage/repositories/readerPreferences.test.ts  — new test for v2.2→v2.3 record loads cleanly
src/storage/repositories/settings.ts                — add getFocusModeHintShown / setFocusModeHintShown
src/storage/repositories/settings.test.ts           — round-trip test
src/storage/db/schema.ts                            — extend SettingsRecord with 'focusModeHintShown'
src/features/reader/ReaderView.tsx                  — slim; expose state via onStateChange; sheet rendering moves to workspace
src/features/reader/ReaderChrome.tsx                — accept showFocusToggle + onToggleFocus props; hide ☰ on desktop
docs/02-system-architecture.md                      — Decision history entry for 2.3
docs/04-implementation-roadmap.md                   — mark Phase 2.3 (and Phase 2 overall) complete
```

## 11. Dependencies

**No new dependencies.**

## 12. Explicit follow-ups (NOT in this PR)

- **Right rail (three-pane)** — naturally lands in Phase 3 when annotations exist
- **Resizable rail** — drag handle on rail edge to adjust width; deferred to Phase 6 polish
- **Drag-to-resize bottom sheet** — partial (peek) vs full sheet height; deferred to Phase 6
- **Right-rail "Inspector" content for v2.3** — explicitly not built (would be dead chrome)
- **Hover-cursor auto-hide in focus mode** — `cursor: none` after inactivity; deferred to Phase 6
- **Touch-swipe gestures on mobile sheets** — pull-down to dismiss; deferred to Phase 6
- **App.tsx full extraction** — completed in this PR; no follow-up needed

## 13. Validation checklist (for the implementation phase)

- [ ] `pnpm check` green (all unit tests + type-check + lint)
- [ ] `pnpm test:e2e` green (16 prior + 4 new = 20)
- [ ] `pnpm dev` — manually open EPUB and PDF on desktop and mobile viewport
- [ ] Desktop: rail visible by default; click TOC entry navigates; `F` enters focus mode; chrome + rail hide; cursor near top reveals chrome; `Esc` exits
- [ ] Mobile (devtools 390×844): rail not visible; ☰ opens bottom sheet; scrim taps dismiss
- [ ] Resize across 768px breakpoint mid-read: layout swap is clean, position preserved
- [ ] Reload while in focus mode: reader fills viewport from first paint (no chrome flash)
- [ ] First-time focus mode entry shows the hint exactly once across reloads
- [ ] No file > 300-line warning threshold (App.tsx ~150 after extraction)
- [ ] No new dependency
