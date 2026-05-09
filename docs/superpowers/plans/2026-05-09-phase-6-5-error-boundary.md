# Phase 6.5 Implementation Plan — Top-level ErrorBoundary + reader-panel error states

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level `AppErrorBoundary` so unhandled render errors surface a recoverable fallback UI instead of a blank page; add `loadError + retryLoad` to four data-loading hooks and corresponding error variants to three panels so repo load failures are visible and recoverable.

**Architecture:** One PR. Class-component error boundary wrapping `<ReadyApp boot={boot} />` with a `LibraryBootError`-styled fallback. Four hooks (`useBookmarks`, `useHighlights`, `useNotes`, `useChatThreads`) extend their handle with `loadError + retryLoad`; their initial-load `useEffect` wraps the repo call in try/catch and uses a `loadNonce` state that participates in the dep array to drive retries. Three panels (`HighlightsPanel`, `BookmarksPanel`, `ThreadList`) gain an error variant with `role="alert"` + Retry button.

**Tech Stack:** React 19, TypeScript, Vitest + `@testing-library/react`, existing `library-boot-error.css` reused for the fallback. No new dependencies.

---

## File map

**New (2):**
- `src/app/AppErrorBoundary.tsx` — class component + `AppErrorFallback` functional component
- `src/app/AppErrorBoundary.test.tsx` — unit tests for the boundary

**Modified (~21):**
- `src/app/App.tsx` — wrap `<ReadyApp boot={boot} />` in `<AppErrorBoundary>`
- `src/features/reader/workspace/useBookmarks.ts` + `useBookmarks.test.ts`
- `src/features/reader/workspace/useHighlights.ts` + `useHighlights.test.ts`
- `src/features/reader/workspace/useNotes.ts` + `useNotes.test.ts`
- `src/features/ai/chat/useChatThreads.ts` + `useChatThreads.test.ts`
- `src/features/reader/HighlightsPanel.tsx` + `HighlightsPanel.test.tsx` + `highlights-panel.css`
- `src/features/reader/BookmarksPanel.tsx` + `BookmarksPanel.test.tsx` + `bookmarks-panel.css`
- `src/features/ai/chat/ThreadList.tsx` + `ThreadList.test.tsx` + `thread-list.css`
- `src/features/reader/workspace/ReaderWorkspace.tsx` — pass `loadError + onRetryLoad` to HighlightsPanel + BookmarksPanel
- `src/features/ai/chat/ChatPanel.tsx` — read `loadError + retryLoad` from `useChatThreads`, pass to ChatHeader
- `src/features/ai/chat/ChatHeader.tsx` — pass through to ThreadList
- `docs/04-implementation-roadmap.md` — mark 6.5 complete

---

## Task 1: `AppErrorBoundary` class + `AppErrorFallback` (TDD)

**Files:**
- Create: `src/app/AppErrorBoundary.tsx`
- Create: `src/app/AppErrorBoundary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/AppErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';

afterEach(cleanup);

function Throw({ message }: { message: string }): never {
  throw new Error(message);
}

describe('AppErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <AppErrorBoundary>
        <p>hello</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeDefined();
  });

  it('catches a render-time throw and renders the fallback', () => {
    // React logs a console.error for the caught error; silence it for clarity.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Throw message="boom" />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong.')).toBeDefined();
    expect(screen.getByRole('button', { name: /reload bookworm/i })).toBeDefined();
    errSpy.mockRestore();
  });

  it('keeps error.message hidden by default but reveals on details expand', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Throw message="boom message" />
      </AppErrorBoundary>,
    );
    // <details> renders a summary; the message is in the <pre> inside.
    const summary = screen.getByText(/show details/i);
    expect(summary).toBeDefined();
    // Native <details> open attribute is what gates visibility — verify the
    // closest <details> element starts closed.
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    // Open it and assert the message is now in the DOM tree.
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByText(/boom message/i)).toBeDefined();
    errSpy.mockRestore();
  });

  it('reload button calls window.location.reload', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reloadMock = vi.fn();
    // Replace location.reload non-destructively.
    const originalReload = window.location.reload;
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reloadMock,
    });
    try {
      render(
        <AppErrorBoundary>
          <Throw message="boom" />
        </AppErrorBoundary>,
      );
      fireEvent.click(screen.getByRole('button', { name: /reload bookworm/i }));
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.location, 'reload', {
        configurable: true,
        value: originalReload,
      });
      errSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/AppErrorBoundary.test.tsx`
Expected: FAIL — module `./AppErrorBoundary` not found.

- [ ] **Step 3: Implement `AppErrorBoundary.tsx`**

Create `src/app/AppErrorBoundary.tsx`. The fallback reuses the *CSS classes* from `library-boot-error.css` — no runtime import needed:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import '@/features/library/library-boot-error.css';

type Props = { readonly children: ReactNode };
type State = { readonly error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] caught render error', error, info);
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <AppErrorFallback
        error={this.state.error}
        onReload={() => window.location.reload()}
      />
    );
  }
}

type FallbackProps = {
  readonly error: Error;
  readonly onReload: () => void;
};

function AppErrorFallback({ error, onReload }: FallbackProps) {
  return (
    <main className="library-boot-error" aria-labelledby="app-error-title">
      <div className="library-boot-error__plate">
        <p className="library-boot-error__eyebrow">Bookworm</p>
        <h1 id="app-error-title" className="library-boot-error__title">
          Something went wrong.
        </h1>
        <p className="library-boot-error__body">
          Bookworm crashed. Reloading usually clears this.
        </p>
        <details className="library-boot-error__details">
          <summary>Show details</summary>
          <pre className="library-boot-error__details-pre">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
        <button className="library-boot-error__action" type="button" onClick={onReload}>
          Reload Bookworm
        </button>
      </div>
    </main>
  );
}
```

Note: the spec mentioned a `private reset` method reserved for future tier-2 use. It's omitted here per YAGNI — the spec calls it "presence costs nothing" but unused private methods trip strict lint configs. If a tier-2 PR needs reset, add it then.

- [ ] **Step 4: Add CSS for the new `<details>` element**

Modify `src/features/library/library-boot-error.css` to add the details/pre styles. Read the existing file first to find the right place:

Run: `wc -l src/features/library/library-boot-error.css`

Append at the bottom:

```css
.library-boot-error__details {
  margin-block: var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text-subtle);
}

.library-boot-error__details summary {
  cursor: pointer;
  padding: var(--space-1) 0;
  user-select: none;
}

.library-boot-error__details summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.library-boot-error__details-pre {
  margin-block: var(--space-3) 0;
  padding: var(--space-3);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  max-height: 12rem;
  overflow-y: auto;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/app/AppErrorBoundary.test.tsx`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/AppErrorBoundary.tsx src/app/AppErrorBoundary.test.tsx \
        src/features/library/library-boot-error.css
git commit -m "$(cat <<'EOF'
feat(app): AppErrorBoundary with collapsible error details (Phase 6.5)

Class component + functional fallback in src/app/AppErrorBoundary.tsx.
Catches render-time errors anywhere in the app post-boot. Fallback is
visually consistent with LibraryBootError (reuses library-boot-error.css);
adds <details> styles for the collapsible "Show details" affordance.

Not wired to <ReadyApp /> yet — that's the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `AppErrorBoundary` into `App.tsx`

**Files:**
- Modify: `src/app/App.tsx:450`

- [ ] **Step 1: Add the import**

In `src/app/App.tsx`, add to the imports near the top (after the existing `LibraryBootError` import on line 18):

```tsx
import { AppErrorBoundary } from '@/app/AppErrorBoundary';
```

- [ ] **Step 2: Wrap the final return**

Find `App.tsx:450`:

```tsx
  return <ReadyApp boot={boot} />;
}
```

Replace with:

```tsx
  return (
    <AppErrorBoundary>
      <ReadyApp boot={boot} />
    </AppErrorBoundary>
  );
}
```

- [ ] **Step 3: Run quality gate**

Run: `pnpm check`
Expected: green (963+ unit tests pass; type-check + lint clean).

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): wrap ReadyApp in AppErrorBoundary (Phase 6.5)

Catches render-time errors anywhere in the app post-boot. Boot-state
branches (loading, LibraryBootError) are NOT wrapped — they have their
own explicit error handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useBookmarks` — `loadError` + `retryLoad`

**Files:**
- Modify: `src/features/reader/workspace/useBookmarks.ts`
- Modify: `src/features/reader/workspace/useBookmarks.test.ts`

- [ ] **Step 1: Add the failing test cases**

In `src/features/reader/workspace/useBookmarks.test.ts`, add a new `describe` block near the bottom of the file (before the closing of any outer describe):

```ts
describe('useBookmarks load error handling', () => {
  it('exposes loadError when listByBook rejects', async () => {
    const repo: BookmarksRepository = {
      add: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      listByBook: vi.fn(() => Promise.reject(new Error('db is gone'))),
      deleteByBook: vi.fn(),
    };
    const { result } = renderHook(() =>
      useBookmarks({
        bookId: BookId('b1'),
        repo,
        readerState: fakeReaderState(),
      }),
    );
    await waitFor(() => {
      expect(result.current.loadError).not.toBeNull();
    });
    expect(result.current.loadError?.message).toBe('db is gone');
    expect(result.current.list).toEqual([]);
  });

  it('retryLoad clears loadError and re-runs the load on success', async () => {
    let attempt = 0;
    const repo: BookmarksRepository = {
      add: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      listByBook: vi.fn(() => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('first try'));
        return Promise.resolve([] as readonly Bookmark[]);
      }),
      deleteByBook: vi.fn(),
    };
    const { result } = renderHook(() =>
      useBookmarks({
        bookId: BookId('b1'),
        repo,
        readerState: fakeReaderState(),
      }),
    );
    await waitFor(() => {
      expect(result.current.loadError).not.toBeNull();
    });
    act(() => {
      result.current.retryLoad();
    });
    await waitFor(() => {
      expect(result.current.loadError).toBeNull();
    });
    expect(repo.listByBook).toHaveBeenCalledTimes(2);
  });

  it('retryLoad after second rejection still surfaces the new error', async () => {
    const repo: BookmarksRepository = {
      add: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      listByBook: vi.fn(() => Promise.reject(new Error('still broken'))),
      deleteByBook: vi.fn(),
    };
    const { result } = renderHook(() =>
      useBookmarks({
        bookId: BookId('b1'),
        repo,
        readerState: fakeReaderState(),
      }),
    );
    await waitFor(() => {
      expect(result.current.loadError?.message).toBe('still broken');
    });
    act(() => {
      result.current.retryLoad();
    });
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledTimes(2);
    });
    expect(result.current.loadError?.message).toBe('still broken');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/reader/workspace/useBookmarks.test.ts`
Expected: FAIL — `result.current.loadError` and `result.current.retryLoad` undefined.

- [ ] **Step 3: Implement the changes in `useBookmarks.ts`**

Modify `src/features/reader/workspace/useBookmarks.ts`. First, extend the handle type:

```ts
export type UseBookmarksHandle = {
  readonly list: readonly Bookmark[];
  readonly loadError: Error | null;
  readonly retryLoad: () => void;
  readonly add: () => Promise<void>;
  readonly remove: (b: Bookmark) => Promise<void>;
};
```

Replace the load `useEffect` (the block starting around line 27) and add the new state + retry callback:

```ts
export function useBookmarks({ bookId, repo, readerState }: Options): UseBookmarksHandle {
  const [list, setList] = useState<readonly Bookmark[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const records = await repo.listByBook(bookId);
        if (!cancelled) setList(sortNewestFirst(records));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, repo, loadNonce]);

  const retryLoad = useCallback(() => {
    setLoadNonce((n) => n + 1);
  }, []);

  // ... existing add, remove callbacks unchanged ...

  return { list, loadError, retryLoad, add, remove };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/reader/workspace/useBookmarks.test.ts`
Expected: all tests pass (including existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/workspace/useBookmarks.ts \
        src/features/reader/workspace/useBookmarks.test.ts
git commit -m "$(cat <<'EOF'
feat(reader): useBookmarks loadError + retryLoad (Phase 6.5)

Wraps the initial repo.listByBook call in try/catch; surfaces failures
through the handle as loadError. retryLoad re-runs the load via a
nonce in the effect dep array. Mutation methods (add, remove)
unchanged — they already had try/catch with rollback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `useHighlights` — `loadError` + `retryLoad`

**Files:**
- Modify: `src/features/reader/workspace/useHighlights.ts`
- Modify: `src/features/reader/workspace/useHighlights.test.ts`

Same shape as Task 3.

- [ ] **Step 1: Add the failing test cases**

Add to `src/features/reader/workspace/useHighlights.test.ts` (mirror Task 3 Step 1, replacing `useBookmarks` → `useHighlights`, `BookmarksRepository` → `HighlightsRepository`, `Bookmark` → `Highlight`, and using the existing `fakeRepo` factory in that test file). The three test cases follow the exact same shape as Task 3:

1. `exposes loadError when listByBook rejects`
2. `retryLoad clears loadError and re-runs the load on success`
3. `retryLoad after second rejection still surfaces the new error`

Open the existing `useHighlights.test.ts` to find the `fakeRepo` factory it uses; add the three tests in a new `describe('useHighlights load error handling', ...)` block. The repo mock for the rejecting case mirrors:

```ts
const rejectingRepo: HighlightsRepository = {
  ...stubAllOtherMethods, // see existing test file's fakeRepo for the shape
  listByBook: vi.fn(() => Promise.reject(new Error('db is gone'))),
};
```

(The existing test file already has a `fakeRepo` helper; copy its non-`listByBook` methods so only the load call rejects.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/reader/workspace/useHighlights.test.ts`
Expected: FAIL — `loadError` / `retryLoad` undefined.

- [ ] **Step 3: Implement the changes in `useHighlights.ts`**

Apply the same pattern as Task 3:

1. Extend `UseHighlightsHandle` type with `readonly loadError: Error | null;` and `readonly retryLoad: () => void;`
2. Add `const [loadError, setLoadError] = useState<Error | null>(null);` and `const [loadNonce, setLoadNonce] = useState(0);`
3. Replace the load `useEffect` body with the same try/catch shape from Task 3 Step 3 (using `setList(sortInBookOrder(records))` instead of `sortNewestFirst`)
4. Add `loadNonce` to the effect dep array
5. Add `const retryLoad = useCallback(() => setLoadNonce((n) => n + 1), []);`
6. Return `{ list, loadError, retryLoad, ...existingActions }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/reader/workspace/useHighlights.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/workspace/useHighlights.ts \
        src/features/reader/workspace/useHighlights.test.ts
git commit -m "$(cat <<'EOF'
feat(reader): useHighlights loadError + retryLoad (Phase 6.5)

Same pattern as useBookmarks: try/catch around the initial load,
loadError exposed via the handle, retryLoad re-runs via a dep nonce.
Mutation paths unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `useNotes` — `loadError` + `retryLoad`

**Files:**
- Modify: `src/features/reader/workspace/useNotes.ts`
- Modify: `src/features/reader/workspace/useNotes.test.ts`

Verified during planning: `useNotes.ts:34` uses the identical `void repo.listByBook(bookId).then(...)` pattern. The handle returns a `ReadonlyMap<HighlightId, Note>` instead of a list, but the load mechanism is uniform with the others.

- [ ] **Step 1: Add the failing test cases**

In `src/features/reader/workspace/useNotes.test.ts`, add a `describe('useNotes load error handling', ...)` block with three tests in the same shape as Task 3, adapted:
- "exposes loadError when listByBook rejects" — assert `result.current.byHighlightId.size === 0` and `result.current.loadError?.message === 'db is gone'`.
- "retryLoad clears loadError and re-runs the load on success" — same structure.
- "retryLoad after second rejection still surfaces the new error" — same structure.

The repo factory for `NotesRepository` lives in the existing test file. If a `fakeRepo` helper isn't there yet, write a minimal one inline:

```ts
const rejectingRepo: NotesRepository = {
  upsert: vi.fn(() => Promise.resolve()),
  deleteByHighlight: vi.fn(() => Promise.resolve()),
  listByBook: vi.fn(() => Promise.reject(new Error('db is gone'))),
  deleteByBook: vi.fn(() => Promise.resolve()),
};
```

(Verify the actual `NotesRepository` interface in `src/storage/repositories/notes.ts` or wherever it's defined — adjust mocked methods to match.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/reader/workspace/useNotes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the changes in `useNotes.ts`**

Apply the uniform pattern:

1. Extend `UseNotesHandle` with `readonly loadError: Error | null;` and `readonly retryLoad: () => void;`
2. Add `loadError` + `loadNonce` state
3. Replace the load `useEffect` body (lines 32–40 of current file) with the try/catch + nonce shape:

```ts
useEffect(() => {
  let cancelled = false;
  setLoadError(null);
  void (async () => {
    try {
      const records = await repo.listByBook(bookId);
      if (!cancelled) setByHighlightId(buildMap(records));
    } catch (err) {
      if (!cancelled) {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();
  return () => {
    cancelled = true;
  };
}, [bookId, repo, loadNonce]);
```

4. Add `retryLoad` callback
5. Return `{ byHighlightId, loadError, retryLoad, save, clear }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/reader/workspace/useNotes.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/workspace/useNotes.ts \
        src/features/reader/workspace/useNotes.test.ts
git commit -m "$(cat <<'EOF'
feat(reader): useNotes loadError + retryLoad (Phase 6.5)

Uniform with useBookmarks/useHighlights: try/catch around the
initial load, loadError exposed via handle, retryLoad via dep nonce.
Existing mutation paths (save, clear) unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `useChatThreads` — `loadError` + `retryLoad`

**Files:**
- Modify: `src/features/ai/chat/useChatThreads.ts`
- Modify: `src/features/ai/chat/useChatThreads.test.ts`

Note: this hook's load lives in an `async IIFE` (`void (async () => { const fetched = await threadsRepo.listByBook(bookId); ... })();`) — already nearly the right shape. We just need to add try/catch around the await and expose error/retry.

- [ ] **Step 1: Add the failing test cases**

Add a `describe('useChatThreads load error handling', ...)` block to `src/features/ai/chat/useChatThreads.test.ts` with three tests mirroring Task 3 (replacing `BookmarksRepository` → `ChatThreadsRepository`, `Bookmark` → `ChatThread`).

The rejecting repo:

```ts
const rejectingThreadsRepo: ChatThreadsRepository = {
  ...stubAllOtherMethods, // see existing test file's helpers for the shape
  listByBook: vi.fn(() => Promise.reject(new Error('db is gone'))),
};
```

If `useChatThreads` takes a `messagesRepo` too (per the existing API at line 33+), pass a stub for that as well — see the existing test file's setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/ai/chat/useChatThreads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the changes in `useChatThreads.ts`**

Apply the uniform pattern:

1. Extend the handle type (currently around lines 17–22) with `readonly loadError: Error | null;` and `readonly retryLoad: () => void;`
2. Add state: `const [loadError, setLoadError] = useState<Error | null>(null);` and `const [loadNonce, setLoadNonce] = useState(0);`
3. Replace the load `useEffect` body (around lines 37–51) with the try/catch shape:

```ts
useEffect(() => {
  let cancelled = false;
  setLoadError(null);
  void (async () => {
    try {
      const fetched = await threadsRepo.listByBook(bookId);
      if (cancelled) return;
      setList(fetched);
      if (fetched.length > 0) {
        setActiveId((prev) => prev ?? fetched[0]?.id ?? null);
      }
    } catch (err) {
      if (!cancelled) {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();
  return () => {
    cancelled = true;
  };
}, [bookId, threadsRepo, loadNonce]);
```

4. Add `retryLoad` callback
5. Return `{ list, loadError, retryLoad, ...existingFields }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/ai/chat/useChatThreads.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/chat/useChatThreads.ts \
        src/features/ai/chat/useChatThreads.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): useChatThreads loadError + retryLoad (Phase 6.5)

Uniform with reader hooks: try/catch around the initial load,
loadError exposed via handle, retryLoad via dep nonce.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `HighlightsPanel` error variant + CSS

**Files:**
- Modify: `src/features/reader/HighlightsPanel.tsx`
- Modify: `src/features/reader/HighlightsPanel.test.tsx`
- Modify: `src/features/reader/highlights-panel.css`

- [ ] **Step 1: Add the failing test case**

In `src/features/reader/HighlightsPanel.test.tsx`, add a new `describe` block (or a new `it`) inside the existing `describe('HighlightsPanel', ...)`:

```tsx
it('renders an error variant with role="alert" + Retry when loadError is set', () => {
  const onRetry = vi.fn();
  render(
    <HighlightsPanel
      highlights={[]}
      notesByHighlightId={EMPTY_NOTES}
      onSelect={() => undefined}
      onDelete={() => undefined}
      onChangeColor={() => undefined}
      onSaveNote={() => undefined}
      loadError={new Error('boom')}
      onRetryLoad={onRetry}
    />,
  );
  expect(screen.getByRole('alert')).toBeDefined();
  expect(screen.getByText(/couldn['’]t load highlights/i)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/reader/HighlightsPanel.test.tsx`
Expected: FAIL — `loadError` / `onRetryLoad` props don't exist; no element with role="alert".

- [ ] **Step 3: Add the props and error-variant render**

In `src/features/reader/HighlightsPanel.tsx`, extend `Props`:

```tsx
type Props = {
  // ... existing props ...
  readonly loadError?: Error | null;
  readonly onRetryLoad?: () => void;
};
```

Destructure in the function signature and add the early return BEFORE the existing `if (highlights.length === 0)` empty-state check:

```tsx
export function HighlightsPanel({
  highlights,
  notesByHighlightId,
  onSelect,
  onDelete,
  onChangeColor,
  onSaveNote,
  nowMs,
  isHighlightInCompare,
  canAddMoreToCompare,
  onToggleHighlightInCompare,
  loadError,
  onRetryLoad,
}: Props) {
  const [editingNoteFor, setEditingNoteFor] = useState<HighlightId | null>(null);

  if (loadError != null) {
    return (
      <aside
        className="highlights-panel highlights-panel--error"
        aria-label="Highlights"
        role="alert"
      >
        <p className="highlights-panel__error-icon" aria-hidden="true">!</p>
        <p className="highlights-panel__error-title">Couldn&rsquo;t load highlights</p>
        <button
          type="button"
          className="highlights-panel__error-action"
          onClick={onRetryLoad}
        >
          Retry
        </button>
      </aside>
    );
  }

  if (highlights.length === 0) {
    // ... existing empty-state branch unchanged ...
  }
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Add the CSS**

Append to `src/features/reader/highlights-panel.css`:

```css
.highlights-panel--error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}

.highlights-panel__error-icon {
  font-family: var(--font-serif);
  font-size: var(--text-2xl);
  color: var(--color-warning, #b45309);
  margin: 0;
}

.highlights-panel__error-title {
  font-family: var(--font-serif);
  font-size: var(--text-md);
  color: var(--color-text);
  margin: 0;
}

.highlights-panel__error-action {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: var(--text-sm);
  color: var(--color-accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out);
}

.highlights-panel__error-action:hover {
  background: var(--color-surface);
}

.highlights-panel__error-action:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

If `--color-warning` is not defined in `tokens.css`, add it. Run `grep -n 'color-warning' src/design-system/tokens.css` first. If it doesn't exist, add to `tokens.css` in the `:root` block:

```css
  --color-warning: #b45309;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/reader/HighlightsPanel.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/HighlightsPanel.tsx \
        src/features/reader/HighlightsPanel.test.tsx \
        src/features/reader/highlights-panel.css \
        src/design-system/tokens.css
git commit -m "$(cat <<'EOF'
feat(reader): HighlightsPanel error variant with retry (Phase 6.5)

When loadError is set, render an aside with role="alert", an icon, a
title, and a Retry button that invokes onRetryLoad. Reuses the
existing panel layout; differs only in icon, color, and action.

Adds --color-warning token if not already present.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `BookmarksPanel` error variant + CSS

**Files:**
- Modify: `src/features/reader/BookmarksPanel.tsx`
- Modify: `src/features/reader/BookmarksPanel.test.tsx`
- Modify: `src/features/reader/bookmarks-panel.css`

Same shape as Task 7. Copy substitutions: "highlights" → "bookmarks". Section title: "Couldn't load bookmarks".

- [ ] **Step 1: Add the failing test case**

In `src/features/reader/BookmarksPanel.test.tsx`, add inside the existing `describe('BookmarksPanel', ...)`:

```tsx
it('renders an error variant with role="alert" + Retry when loadError is set', () => {
  const onRetry = vi.fn();
  render(
    <BookmarksPanel
      bookmarks={[]}
      onSelect={() => undefined}
      onRemove={() => undefined}
      loadError={new Error('boom')}
      onRetryLoad={onRetry}
    />,
  );
  expect(screen.getByRole('alert')).toBeDefined();
  expect(screen.getByText(/couldn['’]t load bookmarks/i)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
```

(Adjust the `BookmarksPanel` prop list to match the actual existing prop names — `onSelect` / `onRemove` / etc. Read the existing test file to mirror its prop call style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/reader/BookmarksPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the props and render branch**

Mirror Task 7 Step 3, replacing `highlights` → `bookmarks` and class names accordingly. The render branch:

```tsx
if (loadError != null) {
  return (
    <aside
      className="bookmarks-panel bookmarks-panel--error"
      aria-label="Bookmarks"
      role="alert"
    >
      <p className="bookmarks-panel__error-icon" aria-hidden="true">!</p>
      <p className="bookmarks-panel__error-title">Couldn&rsquo;t load bookmarks</p>
      <button
        type="button"
        className="bookmarks-panel__error-action"
        onClick={onRetryLoad}
      >
        Retry
      </button>
    </aside>
  );
}
```

- [ ] **Step 4: Add the CSS**

Append to `src/features/reader/bookmarks-panel.css` (same blocks as Task 7 Step 4 but with `.bookmarks-panel` prefixes instead of `.highlights-panel`):

```css
.bookmarks-panel--error { /* same body as highlights-panel--error */ }
.bookmarks-panel__error-icon { /* same body */ }
.bookmarks-panel__error-title { /* same body */ }
.bookmarks-panel__error-action { /* same body, including transition + hover + focus-visible */ }
```

(Copy the rules verbatim from Task 7 Step 4 with the class-name swap.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/reader/BookmarksPanel.test.tsx`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/BookmarksPanel.tsx \
        src/features/reader/BookmarksPanel.test.tsx \
        src/features/reader/bookmarks-panel.css
git commit -m "$(cat <<'EOF'
feat(reader): BookmarksPanel error variant with retry (Phase 6.5)

Same shape as HighlightsPanel error variant: aside with role="alert",
icon + title + Retry button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `ThreadList` error variant + CSS

**Files:**
- Modify: `src/features/ai/chat/ThreadList.tsx`
- Modify: `src/features/ai/chat/ThreadList.test.tsx`
- Modify: `src/features/ai/chat/thread-list.css`

Same shape as Task 7. Copy: "Couldn't load conversations".

- [ ] **Step 1: Add the failing test case**

In `src/features/ai/chat/ThreadList.test.tsx`, add inside the existing `describe('ThreadList', ...)`:

```tsx
it('renders an error variant with role="alert" + Retry when loadError is set', () => {
  const onRetry = vi.fn();
  render(
    <ThreadList
      threads={[]}
      activeId={null}
      onSelect={() => undefined}
      onClose={() => undefined}
      loadError={new Error('boom')}
      onRetryLoad={onRetry}
    />,
  );
  expect(screen.getByRole('alert')).toBeDefined();
  expect(screen.getByText(/couldn['’]t load conversations/i)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
```

(Verify the `ThreadList` prop names in the existing test file; the props above mirror its current signature but adjust if any name differs.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/ai/chat/ThreadList.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the props and render branch**

Mirror Task 7 Step 3 but for `ThreadList`. The error branch must come BEFORE the existing `if (threads.length === 0)` empty-state check at line 53:

```tsx
if (loadError != null) {
  return (
    <aside
      className="thread-list thread-list--error"
      aria-label="Conversations"
      role="alert"
    >
      <p className="thread-list__error-icon" aria-hidden="true">!</p>
      <p className="thread-list__error-title">Couldn&rsquo;t load conversations</p>
      <button
        type="button"
        className="thread-list__error-action"
        onClick={onRetryLoad}
      >
        Retry
      </button>
    </aside>
  );
}
```

(Verify the existing `ThreadList` outer element type — if it's `<ul>` or `<div>` instead of `<aside>`, match it for visual consistency with the existing empty state at line 53–57. The empty state uses `<p className="thread-list__empty">No conversations yet.</p>` inside what wrapper? Read the file and adjust accordingly.)

- [ ] **Step 4: Add the CSS**

Append to `src/features/ai/chat/thread-list.css` (same blocks as Task 7 Step 4, with `.thread-list` prefixes).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/ai/chat/ThreadList.test.tsx`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/chat/ThreadList.tsx \
        src/features/ai/chat/ThreadList.test.tsx \
        src/features/ai/chat/thread-list.css
git commit -m "$(cat <<'EOF'
feat(chat): ThreadList error variant with retry (Phase 6.5)

Same shape as the reader-panel error variants: aside with
role="alert", icon + title + Retry button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire reader panels through `ReaderWorkspace`

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`

The hook handles already include `loadError + retryLoad` after Tasks 3 & 4. This task just plumbs them to the panels.

- [ ] **Step 1: Locate the panel render sites in `ReaderWorkspace.tsx`**

Run:
```bash
grep -n "<HighlightsPanel\|<BookmarksPanel" src/features/reader/workspace/ReaderWorkspace.tsx
```

There are likely two render sites for each panel — once in the desktop rail content variable and once in the mobile sheet content variable. Both need the new props.

- [ ] **Step 2: Pass new props to HighlightsPanel**

For each `<HighlightsPanel ... />` invocation, add:

```tsx
loadError={highlights.loadError}
onRetryLoad={highlights.retryLoad}
```

(`highlights` is the existing `useHighlights` handle reference in this file. Verify the variable name with `grep -n 'useHighlights\b' src/features/reader/workspace/ReaderWorkspace.tsx`.)

- [ ] **Step 3: Pass new props to BookmarksPanel**

For each `<BookmarksPanel ... />` invocation, add:

```tsx
loadError={bookmarks.loadError}
onRetryLoad={bookmarks.retryLoad}
```

- [ ] **Step 4: Run quality gate**

Run: `pnpm check`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat(reader): wire loadError + retryLoad into reader panels (Phase 6.5)

ReaderWorkspace passes loadError + onRetryLoad from the
useHighlights and useBookmarks handles through to HighlightsPanel
and BookmarksPanel render sites (both desktop rail and mobile sheet).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire `ThreadList` through `ChatPanel` + `ChatHeader`

**Files:**
- Modify: `src/features/ai/chat/ChatPanel.tsx`
- Modify: `src/features/ai/chat/ChatHeader.tsx`

`useChatThreads` is consumed in `ChatPanel.tsx:118`. The threads handle now exposes `loadError + retryLoad` after Task 6. We pass them through `ChatHeader` to `ThreadList`.

- [ ] **Step 1: Pass to ChatHeader from ChatPanel**

In `src/features/ai/chat/ChatPanel.tsx`, find the `<ChatHeader threads={...} ... />` call (search via `grep -n '<ChatHeader' src/features/ai/chat/ChatPanel.tsx`). Add:

```tsx
threadsLoadError={threads.loadError}
onRetryLoadThreads={threads.retryLoad}
```

- [ ] **Step 2: Add the props to ChatHeader's signature**

In `src/features/ai/chat/ChatHeader.tsx`, extend the `Props` type:

```tsx
type Props = {
  // ... existing props ...
  readonly threadsLoadError?: Error | null;
  readonly onRetryLoadThreads?: () => void;
};
```

Destructure and pass through to the `<ThreadList>` invocation:

```tsx
<ThreadList
  threads={threads}
  activeId={activeId}
  onSelect={onSelectThread}
  onClose={onClose}
  loadError={threadsLoadError}
  onRetryLoad={onRetryLoadThreads}
/>
```

- [ ] **Step 3: Run quality gate**

Run: `pnpm check`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/chat/ChatPanel.tsx src/features/ai/chat/ChatHeader.tsx
git commit -m "$(cat <<'EOF'
feat(chat): wire loadError + retryLoad into ThreadList (Phase 6.5)

ChatPanel reads loadError + retryLoad from the useChatThreads handle;
ChatHeader passes them through to ThreadList.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Mark roadmap, verify, push, open PR

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Mark 6.5 complete**

In `docs/04-implementation-roadmap.md`, after the `Phase 6 audit — complete (2026-05-09)` line in the Status block at the top, add:

```markdown
- Phase 6.5 — complete (2026-05-XX)
```

(Replace `XX` with today's date — e.g., `2026-05-09` if the same day.)

- [ ] **Step 2: Final quality gate**

Run: `pnpm check`
Expected: green. ~975 unit tests pass (963 existing + ~12 new across the four hook tests + boundary test + three panel tests).

- [ ] **Step 3: Final e2e**

Run: `pnpm build && pnpm test:e2e`
Expected: 85 passed, 6 skipped. The new error states don't activate during e2e flows (no repo failures injected), so behavior is identical to current main. The axe baselines should not change.

If any e2e fails, investigate root cause — most likely candidates:
- A panel error variant accidentally rendered (props passed when they shouldn't be)
- A test asserting a panel's empty state now finds the error variant instead

If the failure is real, fix before continuing; do not adjust e2e to mask a bug.

- [ ] **Step 4: Commit roadmap mark**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark Phase 6.5 complete

AppErrorBoundary + reader-panel error states landed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin phase-6-5-error-boundary
gh pr create --title "feat: Phase 6.5 — top-level ErrorBoundary + reader-panel error states" --body "$(cat <<'EOF'
## Summary

Resolves the only critical Phase 6 audit finding (F5.3 — no top-level ErrorBoundary) bundled with F5.2 (data-loading hooks silently swallow repo rejections at load time).

**AppErrorBoundary** (F5.3):
- New class component in `src/app/AppErrorBoundary.tsx` wrapping `<ReadyApp boot={boot} />` in `App.tsx:450`
- Fallback visually consistent with `LibraryBootError` (reuses `library-boot-error.css`)
- Collapsible `<details>` "Show details" reveals `error.message + stack`
- "Reload Bookworm" button → `window.location.reload()`
- Tier-1 only; tier-2 per-route boundaries deferred to v1.x

**Hook-level error states** (F5.2):
- `useBookmarks`, `useHighlights`, `useNotes`, `useChatThreads` extend their handle with `loadError + retryLoad`
- Initial load wrapped in try/catch; `loadNonce` in dep array drives retry
- Mutation paths unchanged (already had try/catch + rollback)

**Panel error variants** (F5.2):
- `HighlightsPanel`, `BookmarksPanel`, `ThreadList` render an `aside` with `role="alert"`, "Couldn't load X" copy, and a Retry button when `loadError !== null`
- `TocPanel` unchanged (TOC comes from book reader, not a repo)

**Out of scope:** tier-2 per-route boundaries, tier-3 per-panel boundaries, e2e tests for render errors (hard to inject in prod build), error-reporting telemetry.

## Test plan
- [x] `pnpm check` green (~975 unit tests, +12 new)
- [x] `pnpm test:e2e` green (85 passed, 6 skipped)
- [x] AppErrorBoundary unit tests: renders children, catches throw, details closed by default, reload button works
- [x] Hook tests per affected hook: loadError surfaces on rejection, retryLoad clears + re-runs, second rejection re-surfaces
- [x] Panel tests: error variant renders with role="alert" + Retry, click invokes onRetryLoad
- [x] Manual smoke (deferred, not gating): inject a render error in a Reader component via `pnpm dev`; verify fallback + reload work

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done definition

- All 12 tasks complete with their commits.
- `pnpm check` green; `pnpm test:e2e` green.
- PR opened with the body above.
- Each of the four hooks now exposes `loadError + retryLoad`.
- Each of the three affected panels renders an error variant with `role="alert"` + Retry.
- `<AppErrorBoundary>` wraps `<ReadyApp boot={boot} />` in `App.tsx:450`.
- Roadmap marks `Phase 6.5 — complete (YYYY-MM-DD)`.
