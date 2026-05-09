# Phase 7 — Export notebook (Markdown)

**Status:** approved 2026-05-09
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 7 → "Export notebook" (deferred-exploration candidate).
**Predecessors:** Phase 3 (annotations + notebook); Phase 4.4 (saved answers); existing `useNotebook` hook + `NotebookEntry` discriminated-union types.
**Architecture decisions referenced:** `docs/01-product-prd.md` (privacy: no hidden uploads — exports are user-initiated browser downloads); `docs/05-design-system.md` (motion + color tokens for the Export button); `src/features/annotations/notebook/types.ts` (entry shape).

---

## 1. Goal & scope

Add an export affordance to the per-book notebook view: serialize the user's bookmarks, highlights (with optional notes), and saved AI answers into a portable Markdown file that downloads via the standard browser `<a download>` mechanism. Pure local-first; no upload; user explicitly initiates the action.

### In scope

- **Markdown-only format.** Single output file, plain CommonMark, no GitHub-flavored extensions. Renders cleanly in any editor or Markdown viewer.
- **Currently filtered + searched view.** Export reflects exactly the entries visible in the notebook at click-time. The user shapes scope through existing filter/search; no separate export-time selection UI.
- **Export button in `NotebookChrome` top-right.** Mirrors common header-action patterns. Disabled when zero entries are visible.
- **Pure serialization module** (`exportMarkdown.ts`) + tiny **download helper** (`triggerDownload.ts`). NotebookView wires the click; `useNotebook` hook stays untouched (export is a render-time action, not state).

### Out of scope (deferred)

- **JSON export / round-trip import.** A round-trip backup/restore is a different feature; defer until a real backup or sync use case surfaces.
- **HTML / PDF / EPUB export.** Heavier UX (preview, styling). Defer; Markdown is sufficient for sharing/reading.
- **Multi-book export** (e.g., "export all of my library"). The notebook is per-book; multi-book export is a Library feature, not a Notebook one.
- **In-app preview before download.** Adds modal UX; YAGNI for v1 of this feature.
- **Export-time filter override** (e.g., "Export current view" vs "Export everything"). User uses the existing filter/search.
- **Tags in the export.** `Highlight.tags` is currently unused in the UI; defer until tags become user-facing.
- **Internal IDs.** No `id`, `bookId`, `threadId`, etc. The export is for humans, not for round-trip ingest.
- **`contextRefs[].text`** (the actual passage text saved alongside an answer). The reader has the source; the export is an *index* of saved content, not a duplicate of the underlying book. Reduces export size. Note: per `src/domain/ai/types.ts`, `ContextRef` is a 4-kind union (`passage` / `section` / `highlight` / `chunk`); the spec's earlier-draft references to `'chapter'` and `'retrieval'` were stale chat-mode names rather than ref-kind values. Sources rendering uses the actual four kinds.

---

## 2. Markdown output format

A single, consistent format keyed off the existing `NotebookEntry` discriminated union.

### Document structure

```markdown
# {bookTitle}

> Exported from Bookworm on {YYYY-MM-DD}.

---

## Bookmarks

- **{sectionTitle}** — *{relativeDate}*
  > {snippet text or "(no snippet)"}

(repeat per bookmark)

## Highlights

### {sectionTitle}

> {selectedText}

*{color}* · *{relativeDate}*

> **Note:** {note content if present, multi-line preserved}

(repeat per highlight; section heading repeats only when sectionTitle changes)

## Saved AI answers

### {question on one line}

*{mode} · {modelId} · {relativeDate}*

> {answer content, including any markdown the model returned, scoped inside a blockquote}

**Sources:**
- {sectionTitle} — *{passage|chapter|retrieval (rank N)}*
- ...

> **Your note:** {userNote if present}

(repeat per savedAnswer)
```

### Section ordering

Top-level grouping: **Bookmarks → Highlights → Saved AI answers**. Within each group, ordering matches the notebook view's *current sort* (the `entries: readonly NotebookEntry[]` array is already sorted by `useNotebook`; the export consumes it as-is, then partitions by `kind`).

If a group is empty (filter excluded everything in that kind), its `## Heading` is **omitted entirely** rather than rendered as a "(none)" placeholder.

### Edge cases

| Case | Output |
|---|---|
| Empty entries (filter/search excluded everything) | Header + horizontal rule + `*No entries to export.*` line. The download still happens — empty file is a legitimate signal to the user. |
| Markdown-special chars in user-content (selected text, notes, snippets) | Render inside a blockquote (`> {content}`); blockquote scope contains the markdown specials. No escape pass needed. |
| Markdown-special chars in model-generated answer content | **Scoped inside a blockquote.** Preserves model's intended formatting visually without colliding with our heading hierarchy. The reader sees a quote-block of the answer, which is a reasonable visual treatment for "this came from somewhere else." |
| Markdown-special chars in book title heading | Render as-is — the heading is `# {bookTitle}`. Unusual chars in titles are uncommon enough to defer escape logic; if a real title breaks rendering, an escape pass can land later. |
| `note.content` with newlines | Inside the `> **Note:** ...` blockquote, multi-line via standard `>` continuation. |
| `userNote` with newlines | Same — inside the `> **Your note:** ...` blockquote. |
| Bookmark with `snippet === null` | `(no snippet)` placeholder inside the bookmark's blockquote. |
| Highlight with no associated note | Skip the `> **Note:** ...` line; emit color + date only. |
| `contextRef.kind === 'passage'` | `- {sectionTitle ?? '(no section)'} — *passage*` |
| `contextRef.kind === 'section'` | `- {sectionTitle ?? '(no section)'} — *section*` |
| `contextRef.kind === 'highlight'` | `- (highlight) — *highlight*` (the ref carries only `highlightId`; no friendly title in the ref itself) |
| `contextRef.kind === 'chunk'` | `- (chunk) — *chunk*` (same — only `chunkId` is in the ref) |

### Date formatting

- **Document header date**: ISO `YYYY-MM-DD`, computed from the `nowMs` arg or `new Date()`. Stable for tests.
- **Per-entry date**: relative form when recent (`"3 days ago"`, `"2 weeks ago"`), absolute (`YYYY-MM-DD`) when older than ~30 days. Reuses the existing `relativeTime()` helper at `src/shared/text/relativeTime.ts` (already used by `BookmarksPanel` and `HighlightsPanel`). Tests pass a fixed `nowMs` for deterministic output.

---

## 3. Architecture & file structure

### `src/features/annotations/notebook/exportMarkdown.ts` (new, ~80 lines)

Pure function, no side effects:

```ts
import type { NotebookEntry } from './types';

export type ExportArgs = {
  readonly bookTitle: string;
  readonly entries: readonly NotebookEntry[];
  readonly nowMs?: number;
};

export function exportNotebookToMarkdown(args: ExportArgs): string;
```

Internally partitions `entries` by `kind`, renders each section, joins with `\n`. No imports from React or DOM.

### `src/features/annotations/notebook/triggerDownload.ts` (new, ~20 lines)

```ts
export function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

Standard "create blob, click invisible anchor" download pattern. Synchronous; no async boundary; cleanup in the same function. Tests run in jsdom/happy-dom.

### `NotebookChrome.tsx` modification

Current Props:
```tsx
type Props = {
  readonly bookTitle: string;
  readonly onBack: () => void;
};
```

New Props:
```tsx
type Props = {
  readonly bookTitle: string;
  readonly onBack: () => void;
  readonly onExport: () => void;
  readonly canExport: boolean;
};
```

Renders a new `<button>` to the right of the existing back button:
- Text label: **"Export"** (no icon, matches reader-chrome action style).
- `aria-label="Export notebook"`.
- `disabled={!canExport}` with `title="No entries to export"` when disabled.
- Type `button`; click invokes `onExport`.

CSS additions to `notebook-chrome.css`: a `.notebook-chrome__actions` flex container on the right side + a `.notebook-chrome__action` button class. Reuses design-system tokens (`--font-serif`, `--color-text-muted`, `--color-text`, `--duration-fast`, `--ease-out`). Hover: color → `--color-text`. Disabled: color → `--color-text-subtle`, `cursor: not-allowed`.

### `NotebookView.tsx` modification

Add a `handleExport` callback alongside the existing logic:

```tsx
const canExport = notebook.entries.length > 0;
const handleExport = useCallback(() => {
  const md = exportNotebookToMarkdown({
    bookTitle: props.bookTitle,
    entries: notebook.entries,
  });
  triggerDownload(md, `${slugify(props.bookTitle)}-notebook.md`);
}, [notebook.entries, props.bookTitle]);
```

Wires `onExport={handleExport}` and `canExport={canExport}` into `<NotebookChrome ...>`.

### `slugify` helper

Plan task verifies whether a slugify utility already exists under `src/shared/text/`. If yes, import it. If no, inline a small one in `exportMarkdown.ts` (~5 lines: lowercase, replace non-`[a-z0-9]` with `-`, trim, collapse repeated dashes). Default fallback: if slugified result is empty, use `notebook` as the filename stem.

### File naming

Default download filename: `{slugify(bookTitle)}-notebook.md`. Examples:
- "Pride and Prejudice" → `pride-and-prejudice-notebook.md`
- "1984" → `1984-notebook.md`
- "" or all-special-chars → `notebook.md` (fallback)

---

## 4. UX details

### Button placement & responsive behavior

NotebookChrome already has the back button on the left. The Export button anchors to the right side of the same chrome bar. Existing notebook-chrome.css uses a flex layout that accommodates this without restructuring.

On viewports below ~420px, the chrome compresses but doesn't collapse. The "Export" text label stays visible (no icon-only swap unless real layout testing shows pressure during implementation; defer that decision).

### Empty-state behavior

When `notebook.entries.length === 0`:
- The existing `NotebookEmptyState` covers the body content (with reasons `no-entries` or `no-matches`).
- The Export button is disabled, with `title="No entries to export"`.
- Click is a no-op — no toast, no error, no surprise.

### Privacy

The export is a fully local action — the markdown blob is constructed in memory, handed to the browser via `URL.createObjectURL`, and downloaded via a synthetic anchor click. No network round-trip; no third-party services. Per `docs/01-product-prd.md` privacy goal, this matches "no hidden uploads."

### Accessibility

- Button has explicit `aria-label="Export notebook"`.
- Disabled state communicates via the native `disabled` attribute (assistive tech reads it).
- Focus order: back button → (chrome title, non-focusable) → export button → search bar → list. The new button slots naturally into existing keyboard nav.

---

## 5. Testing

### `exportMarkdown.test.ts` (~7-8 cases)

1. **Empty entries** → returns header + "No entries to export." line.
2. **Single bookmark** → renders the `## Bookmarks` section; `## Highlights` and `## Saved AI answers` sections **omitted** (not rendered as "none" placeholders).
3. **Single highlight, no note** → highlight rendered inside blockquote with color + date; no `> **Note:** ...` line.
4. **Single highlight, with note** → highlight + `> **Note:** ...` line, both inside their blockquotes.
5. **Single saved answer with two contextRefs** → question heading, `*mode · modelId · date*` line, answer content inside blockquote, `**Sources:**` list with two bullets matching kinds.
6. **Mixed entries (one bookmark + one highlight + one saved answer)** → all three sections present in correct order.
7. **Two consecutive highlights with same `sectionTitle`** → second entry omits the duplicate `### sectionTitle` heading (deduplication).
8. **Markdown-special chars in `selectedText`** (e.g., text starting with `>` or `*`) → rendered inside blockquote; output round-trips through a Markdown renderer without breaking.

Tests pass a fixed `nowMs` so the relative-time output is stable.

### `triggerDownload.test.ts` (~3 cases)

Tests run in the same `happy-dom` env the rest of the unit suite uses.

1. **Creates blob with right MIME type** — spy on `URL.createObjectURL`; assert called with a Blob whose `type` is `text/markdown;charset=utf-8`.
2. **Sets `download` attribute** — verify the synthesized anchor has `download={filename}` and a non-empty `href`.
3. **Cleans up: removes anchor + revokes URL** — assert `document.body.contains(a)` is false after the call, and `URL.revokeObjectURL` was invoked with the same URL string.

### `NotebookChrome.test.tsx` modifications (~3 new cases)

1. **Renders Export button when `canExport=true`** — `getByRole('button', { name: /export notebook/i })` exists, is enabled.
2. **Disables Export button when `canExport=false`** — button is `disabled` and has the `title` tooltip.
3. **Click invokes `onExport`** — fireEvent click; spy fires once.

### `NotebookView.test.tsx` integration (~1 new case)

1. **Click Export downloads a Markdown file** — render NotebookView with seeded entries (mock or real repos with fixture data); module-mock `./triggerDownload`; click the Export button; assert `triggerDownload` was called with markdown content (containing the book title) and a filename matching `*-notebook.md`.

Use vitest's `vi.mock('./triggerDownload')` pattern. Mock factory returns a `vi.fn()` for `triggerDownload`; assertions check the call signature.

### No new e2e

Browser-driven download verification is fragile across Playwright contexts. The unit-level coverage (pure serialization + isolated download helper + component-level button wiring + integration test) thoroughly covers the contract. The existing notebook e2e flows (`notebook-edit-inline.spec.ts`, etc.) exercise the chrome and would catch a structural regression.

---

## 6. File summary

```
NEW   src/features/annotations/notebook/exportMarkdown.ts                 ~80 lines
NEW   src/features/annotations/notebook/exportMarkdown.test.ts            ~120 lines, 7-8 cases
NEW   src/features/annotations/notebook/triggerDownload.ts                ~20 lines
NEW   src/features/annotations/notebook/triggerDownload.test.ts           ~60 lines, 3 cases
MOD   src/features/annotations/notebook/NotebookChrome.tsx                add Export button + onExport/canExport props (~10 lines)
MOD   src/features/annotations/notebook/NotebookChrome.test.tsx           3 new test cases
MOD   src/features/annotations/notebook/notebook-chrome.css               .notebook-chrome__actions + .notebook-chrome__action styles
MOD   src/features/annotations/notebook/NotebookView.tsx                  wire handleExport + canExport (~10 lines)
MOD   src/features/annotations/notebook/NotebookView.test.tsx             1 new integration test
MOD   docs/04-implementation-roadmap.md                                   mark Phase 7 export-notebook complete
```

10 files. Modest scope — comparable to Phase 6.4 (SW prompts).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Markdown rendering of user content breaks downstream renderers (e.g., a highlight with `*` or `#` breaks layout) | All user-visible content rendered inside blockquotes — the `>` prefix scopes any rogue specials. Test 8 verifies a markdown-special-char highlight round-trips through a renderer. |
| Browser blocks the download | The `<a download>` click pattern works inside user-initiated handlers across all PWA-target browsers. Not an automated download. |
| `URL.createObjectURL` leak | Cleanup is synchronous in the same function; no async boundary; test 3 verifies. |
| Filename with non-ASCII chars in book title | Slugify normalizes to ASCII; markdown body keeps the original title for display. Avoids historical Safari issues with non-ASCII filenames. |
| `relativeTime()` non-deterministic in tests | Tests pass fixed `nowMs`; matches the existing pattern in `BookmarksPanel.test.tsx` and `HighlightsPanel.test.tsx`. |
| User confused by "Export" exporting only a filtered subset | Resolved by the user's explicit choice in Section 1: "Currently filtered + searched view." If real-world feedback says it's confusing, follow-up: append entry count to the button label ("Export 23 entries"). |
| Saved-answer model content collides with our heading hierarchy | Answer content is wrapped in a blockquote — collision avoided. Visual treatment is consistent with how highlights/notes render. |
| `slugify` produces empty string for unusual titles | Fallback to literal `notebook` as the filename stem. Tested. |
| Module-mock for `triggerDownload` in NotebookView integration test breaks if `triggerDownload` is inlined later | The module is intentionally separated for testability. If a future refactor inlines it, the integration test needs updating — but the inlining cost outweighs the test benefit, so this is unlikely. |

---

## 8. Open questions

None. All UX choices, format details, file shape, and edge cases are settled.

---

## 9. Acceptance criteria

- `src/features/annotations/notebook/exportMarkdown.ts` exists; pure function; 7+ unit tests pass.
- `src/features/annotations/notebook/triggerDownload.ts` exists; 3 unit tests pass.
- `NotebookChrome` renders an "Export" button:
  - enabled when `canExport=true`, disabled with `title="No entries to export"` otherwise
  - has `aria-label="Export notebook"`
  - invokes `onExport` on click
- `NotebookView` wires the click to produce a markdown blob via `triggerDownload`; integration test verifies blob content (contains book title) + filename matches `*-notebook.md`.
- Markdown output matches Section 2's structure exactly (verified by tests 1-8).
- `pnpm check` green (~1029 unit tests, +11 new across the four affected test files).
- `pnpm test:e2e` green (no new specs; no existing-spec regressions).
- Production bundle delta < 5 KB gz (the export module is small; no new deps).
- Roadmap marks `Phase 7 export-notebook — complete (2026-05-XX)`.
