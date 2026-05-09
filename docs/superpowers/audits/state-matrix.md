# Empty / loading / error / success state matrix

Living document. Every user-facing surface in the app, with a presence
check for each canonical state. Filled during the Phase 6 audit
(PR-C, 2026-05-09); kept current as new surfaces are added.

## Surfaces examined

(per `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md` §3.5)

Library, Library import (DropOverlay + ImportTray), BookCard (and its menu),
Reader (EPUB + PDF), TocPanel, HighlightsPanel, BookmarksPanel, NoteEditor,
IndexInspectorModal, Chat thread list, ChatPanel, PrivacyPreview,
SuggestedPrompts, multi-excerpt tray, Settings.

## Matrix

Legend: ✓ present and adequate · ◐ present but inadequate (generic, no recovery) · ✗ absent (blank screen / silent) · — not applicable.

| Surface | Loading | Empty | Success | Error | Notes |
|---|---|---|---|---|---|
| **App boot** (`src/app/App.tsx:440-449`) | ✓ "Reaching for your library…" | — | renders ReadyApp | ✓ `<LibraryBootError>` with reason | Boot states explicit at the top level. |
| **Library** (`LibraryView`, `Bookshelf`) | — (handled at App boot) | ✓ `<LibraryEmptyState>` rich first-run | ✓ Bookshelf grid | — (boot-level only) | Strong. |
| **Library import — DropOverlay** (`DropOverlay`) | — | — | drag affordance shown | — | Pure affordance; no states needed. |
| **Library import — ImportTray** (`ImportTrayItem.tsx:25-38`) | ✓ `running` (◐ symbol) | — (tray hides when entries empty) | ✓ `done` (✓ symbol) | ✓ `failed` with reason text + `duplicate` variant | Clean state-machine: waiting / running / done / duplicate / failed. |
| **BookCard** (`BookCard.tsx`) | — | — | ✓ always renders card | ✗ no per-card error state if cover fails to load | F5.5 — cover-load failure silently shows broken-image; consider fallback. |
| **BookCardMenu** (`BookCardMenu.tsx`) | — | — | ✓ menu items | — | Stateless dropdown. |
| **Reader (ReaderWorkspace + ReaderView)** | ✓ "Opening book…" overlay (`ReaderView.tsx:300`, `role="status"`) | — | ✓ renders | ✓ error overlay with `role="alert"` + descriptive message via `describeError()` + "Back to library" recovery (`ReaderView.tsx:305-312`) | Strong. State machine transitions to `error` per `readerMachine.ts:110, 141`. Error variants: blob-missing, parse-failed, unsupported-format, engine-crashed. |
| **TocPanel** (`TocPanel.tsx:11-15`) | — (data sync from book) | ✓ "No chapters in this book." | ✓ entry list | ✗ no error state if TOC extract throws | F5.2 |
| **HighlightsPanel** (`HighlightsPanel.tsx:40-50`) | — | ✓ rich empty: title + hint + icon | ✓ list | ✗ no error state if repo throws | F5.2 |
| **BookmarksPanel** (`BookmarksPanel.tsx:13-22`) | — | ✓ rich empty: title + hint + icon | ✓ list | ✗ no error state if repo throws | F5.2 |
| **NoteEditor** (`NoteEditor.tsx`) | — | ◐ editor is just empty when no note text | ✓ editing UI | ✗ no error state if save fails | F5.6 nice-to-have |
| **IndexInspectorModal** (`IndexInspectorModal.tsx:102`) | ✓ "Loading…" | ◐ no explicit empty state (table just empty) | ✓ chunk rows | ✗ no error state if chunks fetch fails | F5.7 |
| **Chat thread list** (`ThreadList.tsx:53-57`) | — | ✓ "No conversations yet." | ✓ list with hover-reveal delete | ✗ no error state if threads fetch fails | F5.2 |
| **ChatPanel** (`ChatPanel.tsx`) | ✓ streaming caret (`message-bubble.css:45`) | ✓ rich `no-key` / `no-model` / `no-threads` variants in `ChatEmptyState` | ✓ MessageList | ✓ `<ChatErrorBubble role="alert">` with retry | Strongest surface — all four states first-class. |
| **PrivacyPreview** (`PrivacyPreview.tsx`) | — | — | ✓ preview | — | Pure data-driven preview; no states needed. |
| **SuggestedPrompts** (per Phase 5.3) | ✓ loading state | ✓ `no-chunks` empty | ✓ prompt list | ✓ `failed` with retry chip | Comprehensive (Phase 5.3 invested heavily here). |
| **Multi-excerpt tray** (`MultiExcerptChip.tsx:27`) | — | ✓ returns null when 0 excerpts (chip just doesn't render) | ✓ chip with preview | — | `null` is the correct empty behavior. |
| **Settings** (`SettingsView.tsx`) | ✓ model catalog loading | — | ✓ form + status card | ✓ rich error states (validated by existing e2e: `settings-validation-error`, `settings-models-error`, etc.) | Strong; well-tested. |

## Candidate findings (to triage in PR-C findings doc)

- ~~**F5.1**~~ — *Withdrawn.* Initial reading missed the state-machine-driven error overlay in `ReaderView.tsx:305-312` and the `target: 'error'` transitions in `readerMachine.ts:110, 141`. Reader's error handling is comprehensive: overlay with `role="alert"`, descriptive message via `describeError()`, and a "Back to library" recovery button. The `} catch {}` silent blocks at lines 151, 188, 202 are *secondary*-path catches (snippet extraction, anchor resolution) that fall through to safe defaults rather than the main book-load path.
- **F5.2 (important)** — Reader panels (TocPanel, HighlightsPanel, BookmarksPanel) and ThreadList have no error state if their respective repos throw. The DB is local IndexedDB so failures are unlikely, but a corrupted store would show as a blank panel. Severity: **important**.
- **F5.3 (critical, ErrorBoundary-related)** — No top-level `ErrorBoundary` anywhere in `src/` (verified by grep). Any unhandled render error after the boot state succeeds will unmount the entire React tree, leaving the user with a blank page and no recovery. See recommendation below. Severity: **critical**.
- ~~**F5.4**~~ — *Withdrawn.* Reader does have a loading overlay ("Opening book…") gated on `status === 'loadingBlob' || 'opening'` per `ReaderView.tsx:300-303`.
- **F5.5 (nice-to-have)** — `BookCard` has no fallback when the cover image fails to render (e.g., extracted cover blob is corrupt). Severity: nice-to-have.
- **F5.6 (nice-to-have)** — `NoteEditor` has no explicit empty-state copy; editor just renders empty. Could be acceptable; flag for design discussion. Severity: nice-to-have.
- **F5.7 (nice-to-have)** — `IndexInspectorModal` has no explicit empty state when there are zero chunks (table is just empty). Severity: nice-to-have.

## ErrorBoundary placement recommendation

### Current state

- No `ErrorBoundary` exists anywhere in `src/` (verified by `grep -rEn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" src --include="*.tsx" --include="*.ts"` returning empty).
- `App.tsx` does have explicit boot-state handling: `loading` → loading message, `error` → `<LibraryBootError>`, `ready` → `<ReadyApp />`. This catches **boot-time** errors only.
- Once `ReadyApp` mounts, any render error in any descendant unmounts the whole tree.

### Recommended placement (PR-C scope writes the spec; the actual ErrorBoundary code is implemented in PR-D for 6.5)

**Tier 1 (mandatory): wrap `<ReadyApp boot={boot} />` in `App.tsx:450`.**

```tsx
return (
  <AppErrorBoundary>
    <ReadyApp boot={boot} />
  </AppErrorBoundary>
);
```

The boundary's fallback UI should:
- State that something went wrong, plainly and without alarm
- Offer a "Reload" button that calls `window.location.reload()`
- Optionally show the error message (collapsed by default — useful for the user reporting the bug)
- Preserve user data: do not clear IndexedDB or any persisted state

The boundary should log to `console.error` so dev-mode + axe console captures it.

**Tier 2 (deferred, decide per findings in PR-D): per-route boundaries.**

Optional finer granularity:
- Around `<NotebookView />` (App.tsx:246) — notebook crash doesn't lose library context
- Around `<SettingsView />` (App.tsx:270)
- Around `<ReaderWorkspace />` (App.tsx:278) — most common crash candidate (PDF.js, EPUB parsing edge cases); a crash here ideally falls back to "couldn't open this book — back to library"

Per-route boundaries are likely worth implementing if F5.1 isn't fixed at the source, since they catch what F5.1 currently silently swallows.

**Tier 3 (deferred, far future): per-panel boundaries** (TocPanel, HighlightsPanel, etc.). Probably overkill for v1.

### Implementation notes for the follow-up spec

- Use a class component (React 19's hook-based error handling is partial; render-error catching still needs class boundaries).
- Single shared component `AppErrorBoundary.tsx` parameterized by fallback variant, used at all tiers.
- Tier-1 fallback should be visually consistent with `LibraryBootError` (already has the right tone).
- Add `tests/AppErrorBoundary.test.tsx` covering: catches synchronous render error, renders fallback, reload button works, preserves the underlying error in state for display.
- E2e: hard to test (no easy way to inject a render error). Skip e2e; unit test is sufficient.
