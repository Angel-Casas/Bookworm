# Phase 7 Export Notebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Export" button to the notebook chrome that downloads a Markdown file containing the user's currently-visible bookmarks, highlights (with notes), and saved AI answers for the active book.

**Architecture:** Pure serialization module (`exportMarkdown.ts`) emits CommonMark from a `NotebookEntry[]`; tiny isolated download helper (`triggerDownload.ts`) handles the Blob → invisible-anchor click flow; `NotebookChrome` gains a top-right Export button; `NotebookView` wires the click. `useNotebook` stays untouched. No new runtime deps.

**Tech Stack:** React 19, TypeScript, Vitest + `@testing-library/react`, existing `relativeTime` helper at `src/shared/text/relativeTime.ts`. No new deps.

---

## File map

**New (4):**
- `src/features/annotations/notebook/exportMarkdown.ts` — pure function: `NotebookEntry[]` → markdown string
- `src/features/annotations/notebook/exportMarkdown.test.ts`
- `src/features/annotations/notebook/triggerDownload.ts` — Blob + anchor click helper
- `src/features/annotations/notebook/triggerDownload.test.ts`

**Modified (5):**
- `src/features/annotations/notebook/NotebookChrome.tsx` — add Export button + `onExport`/`canExport` props
- `src/features/annotations/notebook/NotebookChrome.test.tsx` — 3 new test cases
- `src/features/annotations/notebook/notebook-chrome.css` — `.notebook-chrome__actions` + `.notebook-chrome__action` styles
- `src/features/annotations/notebook/NotebookView.tsx` — wire `handleExport` + `canExport` into chrome
- `src/features/annotations/notebook/NotebookView.test.tsx` — 1 new integration test
- `docs/04-implementation-roadmap.md` — mark Phase 7 export-notebook complete

10 files total.

---

## Task 1: `exportMarkdown` — pure serialization (TDD)

**Files:**
- Create: `src/features/annotations/notebook/exportMarkdown.ts`
- Create: `src/features/annotations/notebook/exportMarkdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/annotations/notebook/exportMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { exportNotebookToMarkdown, slugifyTitle } from './exportMarkdown';
import type { NotebookEntry } from './types';
import { BookId, BookmarkId, ChatMessageId, ChatThreadId, HighlightId, IsoTimestamp, NoteId, SavedAnswerId } from '@/domain';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { SavedAnswer } from '@/domain';

const NOW = new Date('2026-05-09T12:00:00.000Z').getTime();

function bm(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: BookmarkId('b1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
    snippet: 'A bookmarked passage of text.',
    sectionTitle: 'Chapter 1',
    createdAt: IsoTimestamp('2026-05-09T11:50:00.000Z'),
    ...over,
  };
}

function hl(over: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId('h1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)' },
    selectedText: 'A piece of selected text',
    sectionTitle: 'Chapter 2',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-09T11:55:00.000Z'),
    ...over,
  };
}

function noteFor(highlightId: HighlightId, content: string): Note {
  return {
    id: NoteId(`n-${highlightId}`),
    bookId: BookId('book-1'),
    anchorRef: { kind: 'highlight', highlightId },
    content,
    createdAt: IsoTimestamp('2026-05-09T11:56:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-09T11:56:00.000Z'),
  };
}

function ans(over: Partial<SavedAnswer> = {}): SavedAnswer {
  return {
    id: SavedAnswerId('a1'),
    bookId: BookId('book-1'),
    threadId: ChatThreadId('t1'),
    messageId: ChatMessageId('m1'),
    modelId: 'gpt-x',
    mode: 'passage',
    content: 'The answer text.',
    question: 'What is the theme?',
    contextRefs: [],
    createdAt: IsoTimestamp('2026-05-09T11:58:00.000Z'),
    ...over,
  };
}

describe('exportNotebookToMarkdown', () => {
  it('returns header + "No entries to export." when entries is empty', () => {
    const md = exportNotebookToMarkdown({
      bookTitle: 'Pride and Prejudice',
      entries: [],
      nowMs: NOW,
    });
    expect(md).toContain('# Pride and Prejudice');
    expect(md).toContain('Exported from Bookworm on 2026-05-09');
    expect(md).toContain('*No entries to export.*');
    expect(md).not.toContain('## Bookmarks');
  });

  it('renders a single bookmark; Highlights + Saved AI answers headings omitted', () => {
    const entries: NotebookEntry[] = [{ kind: 'bookmark', bookmark: bm() }];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Pride and Prejudice',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('## Bookmarks');
    expect(md).toContain('**Chapter 1**');
    expect(md).toContain('A bookmarked passage of text.');
    expect(md).not.toContain('## Highlights');
    expect(md).not.toContain('## Saved AI answers');
  });

  it('renders a highlight without note (no Note line)', () => {
    const entries: NotebookEntry[] = [{ kind: 'highlight', highlight: hl(), note: null }];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('## Highlights');
    expect(md).toContain('### Chapter 2');
    expect(md).toContain('> A piece of selected text');
    expect(md).toContain('*yellow*');
    expect(md).not.toContain('**Note:**');
  });

  it('renders a highlight WITH note (Note line inside its own blockquote)', () => {
    const h = hl();
    const entries: NotebookEntry[] = [
      { kind: 'highlight', highlight: h, note: noteFor(h.id, 'A thoughtful note.') },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('> A piece of selected text');
    expect(md).toContain('> **Note:** A thoughtful note.');
  });

  it('renders a saved answer with two contextRefs (passage + section)', () => {
    const entries: NotebookEntry[] = [
      {
        kind: 'savedAnswer',
        savedAnswer: ans({
          contextRefs: [
            {
              kind: 'passage',
              text: 'pass1',
              sectionTitle: 'Ch 1',
              anchor: { kind: 'epub-cfi', cfi: 'x' },
            },
            {
              kind: 'section',
              sectionId: 'sec-ch-2' as never,
              sectionTitle: 'Ch 2',
            },
          ],
        }),
      },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('## Saved AI answers');
    expect(md).toContain('### What is the theme?');
    expect(md).toContain('*passage* · *gpt-x* ·');
    expect(md).toContain('> The answer text.');
    expect(md).toContain('**Sources:**');
    expect(md).toContain('- Ch 1 — *passage*');
    expect(md).toContain('- Ch 2 — *section*');
  });

  it('renders contextRefs of kind highlight or chunk with placeholder titles', () => {
    const entries: NotebookEntry[] = [
      {
        kind: 'savedAnswer',
        savedAnswer: ans({
          contextRefs: [
            { kind: 'highlight', highlightId: HighlightId('h-x') },
            { kind: 'chunk', chunkId: 'c-x' as never },
          ],
        }),
      },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    expect(md).toContain('- (highlight) — *highlight*');
    expect(md).toContain('- (chunk) — *chunk*');
  });

  it('mixed entries: all three sections present in correct order', () => {
    const h = hl();
    const entries: NotebookEntry[] = [
      { kind: 'bookmark', bookmark: bm() },
      { kind: 'highlight', highlight: h, note: null },
      { kind: 'savedAnswer', savedAnswer: ans() },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    const idxBookmarks = md.indexOf('## Bookmarks');
    const idxHighlights = md.indexOf('## Highlights');
    const idxAnswers = md.indexOf('## Saved AI answers');
    expect(idxBookmarks).toBeGreaterThan(0);
    expect(idxHighlights).toBeGreaterThan(idxBookmarks);
    expect(idxAnswers).toBeGreaterThan(idxHighlights);
  });

  it('two consecutive highlights with same sectionTitle dedupe the section heading', () => {
    const h1 = hl({ id: HighlightId('h1'), selectedText: 'first quote' });
    const h2 = hl({ id: HighlightId('h2'), selectedText: 'second quote' });
    const entries: NotebookEntry[] = [
      { kind: 'highlight', highlight: h1, note: null },
      { kind: 'highlight', highlight: h2, note: null },
    ];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    // Section heading "### Chapter 2" should appear exactly once.
    const matches = md.match(/^### Chapter 2$/gm);
    expect(matches?.length).toBe(1);
    expect(md).toContain('first quote');
    expect(md).toContain('second quote');
  });

  it('markdown-special chars in selectedText are scoped inside a blockquote', () => {
    const h = hl({ selectedText: '# Should not be a heading\n* not a list' });
    const entries: NotebookEntry[] = [{ kind: 'highlight', highlight: h, note: null }];
    const md = exportNotebookToMarkdown({
      bookTitle: 'Test',
      entries,
      nowMs: NOW,
    });
    // Each line of the selected text must be prefixed by `> `.
    expect(md).toContain('> # Should not be a heading');
    expect(md).toContain('> * not a list');
  });
});

describe('slugifyTitle', () => {
  it('lowercases and replaces non-alphanumerics with dashes', () => {
    expect(slugifyTitle('Pride and Prejudice')).toBe('pride-and-prejudice');
  });

  it('collapses repeated dashes', () => {
    expect(slugifyTitle('A   B')).toBe('a-b');
    expect(slugifyTitle('A: B')).toBe('a-b');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugifyTitle('  Hello!  ')).toBe('hello');
  });

  it('returns "notebook" when slugified result is empty', () => {
    expect(slugifyTitle('')).toBe('notebook');
    expect(slugifyTitle('!!!')).toBe('notebook');
  });

  it('preserves digits', () => {
    expect(slugifyTitle('1984')).toBe('1984');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/annotations/notebook/exportMarkdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/features/annotations/notebook/exportMarkdown.ts`:

```ts
import type { NotebookEntry } from './types';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { SavedAnswer, ContextRef, IsoTimestamp } from '@/domain';
import { relativeTime } from '@/shared/text/relativeTime';

export type ExportArgs = {
  readonly bookTitle: string;
  readonly entries: readonly NotebookEntry[];
  readonly nowMs?: number;
};

export function exportNotebookToMarkdown(args: ExportArgs): string {
  const { bookTitle, entries, nowMs = Date.now() } = args;
  const exportDate = new Date(nowMs).toISOString().slice(0, 10);
  const out: string[] = [`# ${bookTitle}`, '', `> Exported from Bookworm on ${exportDate}.`, '', '---', ''];

  if (entries.length === 0) {
    out.push('*No entries to export.*');
    return out.join('\n');
  }

  const bookmarks = entries.filter((e): e is Extract<NotebookEntry, { kind: 'bookmark' }> => e.kind === 'bookmark');
  const highlights = entries.filter((e): e is Extract<NotebookEntry, { kind: 'highlight' }> => e.kind === 'highlight');
  const answers = entries.filter((e): e is Extract<NotebookEntry, { kind: 'savedAnswer' }> => e.kind === 'savedAnswer');

  if (bookmarks.length > 0) {
    out.push('## Bookmarks', '');
    for (const e of bookmarks) {
      out.push(...renderBookmark(e.bookmark, nowMs));
    }
  }

  if (highlights.length > 0) {
    out.push('## Highlights', '');
    let lastSection: string | null = null;
    for (const e of highlights) {
      if (e.highlight.sectionTitle !== lastSection) {
        out.push(`### ${e.highlight.sectionTitle ?? '(no section)'}`, '');
        lastSection = e.highlight.sectionTitle;
      }
      out.push(...renderHighlight(e.highlight, e.note, nowMs));
    }
  }

  if (answers.length > 0) {
    out.push('## Saved AI answers', '');
    for (const e of answers) {
      out.push(...renderAnswer(e.savedAnswer, nowMs));
    }
  }

  return out.join('\n');
}

function renderBookmark(b: Bookmark, nowMs: number): string[] {
  const date = relativeTime(b.createdAt, nowMs);
  const snippet = b.snippet ?? '(no snippet)';
  const lines: string[] = [
    `- **${b.sectionTitle ?? '(no section)'}** — *${date}*`,
  ];
  for (const line of blockquoteLines(snippet, '  ')) lines.push(line);
  lines.push('');
  return lines;
}

function renderHighlight(h: Highlight, note: Note | null, nowMs: number): string[] {
  const date = relativeTime(h.createdAt, nowMs);
  const lines: string[] = [];
  lines.push(...blockquoteLines(h.selectedText));
  lines.push('', `*${h.color}* · *${date}*`, '');
  if (note) {
    lines.push(`> **Note:** ${firstLine(note.content)}`);
    for (const extra of subsequentLines(note.content)) {
      lines.push(`> ${extra}`);
    }
    lines.push('');
  }
  return lines;
}

function renderAnswer(a: SavedAnswer, nowMs: number): string[] {
  const date = relativeTime(a.createdAt, nowMs);
  const lines: string[] = [
    `### ${oneLine(a.question)}`,
    '',
    `*${a.mode}* · *${a.modelId}* · *${date}*`,
    '',
  ];
  lines.push(...blockquoteLines(a.content));
  lines.push('');
  if (a.contextRefs.length > 0) {
    lines.push('**Sources:**');
    for (const ref of a.contextRefs) {
      lines.push(`- ${refSourceLine(ref)}`);
    }
    lines.push('');
  }
  if (a.userNote) {
    lines.push(`> **Your note:** ${firstLine(a.userNote)}`);
    for (const extra of subsequentLines(a.userNote)) {
      lines.push(`> ${extra}`);
    }
    lines.push('');
  }
  return lines;
}

function refSourceLine(ref: ContextRef): string {
  switch (ref.kind) {
    case 'passage':
      return `${ref.sectionTitle ?? '(no section)'} — *passage*`;
    case 'section':
      return `${ref.sectionTitle ?? '(no section)'} — *section*`;
    case 'highlight':
      return `(highlight) — *highlight*`;
    case 'chunk':
      return `(chunk) — *chunk*`;
  }
}

function blockquoteLines(text: string, indent: string = ''): string[] {
  return text.split('\n').map((line) => `${indent}> ${line}`);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  return idx === -1 ? text : text.slice(0, idx);
}

function subsequentLines(text: string): string[] {
  const idx = text.indexOf('\n');
  if (idx === -1) return [];
  return text.slice(idx + 1).split('\n');
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'notebook';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/annotations/notebook/exportMarkdown.test.ts`
Expected: 13 PASS (8 export + 5 slugify cases).

If tests fail because of type imports (e.g., the `SavedAnswer.contextRefs` shape uses a richer ContextRef union than my mock), adjust the mock to match the actual types. Search the actual `ContextRef` definition: `grep -n "type ContextRef" src/domain/`.

- [ ] **Step 5: Commit**

```bash
git add src/features/annotations/notebook/exportMarkdown.ts \
        src/features/annotations/notebook/exportMarkdown.test.ts
git commit -m "$(cat <<'EOF'
feat(notebook): exportNotebookToMarkdown serializer (Phase 7)

Pure function NotebookEntry[] → CommonMark string. Three sections
(Bookmarks / Highlights / Saved AI answers); empty groups omit their
heading entirely. User content rendered inside blockquotes so
markdown specials in highlights/notes/snippets don't break downstream
renderers. Highlights group dedupes consecutive same-section headings.

Includes slugifyTitle helper for filename generation (lowercase,
non-alphanumerics → dashes, "notebook" fallback for empty results).

Not yet wired into the UI — that's Tasks 3-4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `triggerDownload` — Blob + anchor click helper (TDD)

**Files:**
- Create: `src/features/annotations/notebook/triggerDownload.ts`
- Create: `src/features/annotations/notebook/triggerDownload.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/annotations/notebook/triggerDownload.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { triggerDownload } from './triggerDownload';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('triggerDownload', () => {
  it('creates a Blob with text/markdown MIME type', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    triggerDownload('# Test', 'test.md');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect((blobArg as Blob).type).toBe('text/markdown;charset=utf-8');
  });

  it('sets the download attribute on the synthesized anchor', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') capturedAnchor = el as HTMLAnchorElement;
      return el;
    });
    triggerDownload('# Test', 'my-export.md');
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.getAttribute('download')).toBe('my-export.md');
    expect(capturedAnchor?.getAttribute('href')).toBe('blob:fake');
  });

  it('cleans up: removes the anchor and revokes the URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') capturedAnchor = el as HTMLAnchorElement;
      return el;
    });
    triggerDownload('content', 'f.md');
    expect(capturedAnchor).not.toBeNull();
    if (capturedAnchor !== null) {
      expect(document.body.contains(capturedAnchor)).toBe(false);
    }
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/annotations/notebook/triggerDownload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/features/annotations/notebook/triggerDownload.ts`:

```ts
/**
 * Download a string as a file via the standard "create blob, click invisible
 * anchor" pattern. Synchronous; cleans up the object URL and the anchor in
 * the same call. Must be invoked from a user-initiated event handler so the
 * browser allows the download.
 */
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/annotations/notebook/triggerDownload.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/annotations/notebook/triggerDownload.ts \
        src/features/annotations/notebook/triggerDownload.test.ts
git commit -m "$(cat <<'EOF'
feat(notebook): triggerDownload helper (Phase 7)

Tiny isolated helper for the standard "create blob, click invisible
anchor" download pattern. Synchronous; cleans up URL + anchor in the
same call. text/markdown MIME type. Must be invoked from a
user-initiated event handler.

Not yet wired into the UI — that's Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: NotebookChrome Export button (TDD)

**Files:**
- Modify: `src/features/annotations/notebook/NotebookChrome.tsx`
- Modify: `src/features/annotations/notebook/NotebookChrome.test.tsx`
- Modify: `src/features/annotations/notebook/notebook-chrome.css`

- [ ] **Step 1: Write the failing tests**

In `src/features/annotations/notebook/NotebookChrome.test.tsx`, find the existing `describe('NotebookChrome', () => { ... })` block and append:

```tsx
  it('renders the Export button enabled when canExport is true', () => {
    render(
      <NotebookChrome
        bookTitle="Test"
        onBack={() => undefined}
        onExport={() => undefined}
        canExport={true}
      />,
    );
    const btn = screen.getByRole('button', { name: /export notebook/i });
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the Export button when canExport is false', () => {
    render(
      <NotebookChrome
        bookTitle="Test"
        onBack={() => undefined}
        onExport={() => undefined}
        canExport={false}
      />,
    );
    const btn = screen.getByRole('button', { name: /export notebook/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/no entries/i);
  });

  it('invokes onExport when the button is clicked', () => {
    const onExport = vi.fn();
    render(
      <NotebookChrome
        bookTitle="Test"
        onBack={() => undefined}
        onExport={onExport}
        canExport={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export notebook/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
```

If the existing test file doesn't import `vi` or `fireEvent`, add them to the top-of-file imports (verify by reading the existing test file: `head -10 src/features/annotations/notebook/NotebookChrome.test.tsx`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/annotations/notebook/NotebookChrome.test.tsx`
Expected: 3 new tests FAIL — `onExport` and `canExport` props don't exist on `NotebookChrome`.

- [ ] **Step 3: Update `NotebookChrome.tsx`**

Replace `src/features/annotations/notebook/NotebookChrome.tsx`:

```tsx
import { ArrowLeftIcon } from '@/shared/icons';
import './notebook-chrome.css';

type Props = {
  readonly bookTitle: string;
  readonly onBack: () => void;
  readonly onExport: () => void;
  readonly canExport: boolean;
};

export function NotebookChrome({ bookTitle, onBack, onExport, canExport }: Props) {
  return (
    <header className="notebook-chrome">
      <button
        type="button"
        className="notebook-chrome__back"
        onClick={onBack}
        aria-label="Back to reader"
      >
        <ArrowLeftIcon />
        <span>Reader</span>
      </button>
      <div className="notebook-chrome__title" aria-live="polite">
        <span className="notebook-chrome__title-label">Notebook</span>
        <span className="notebook-chrome__title-sep" aria-hidden="true">
          {' · '}
        </span>
        <span className="notebook-chrome__title-book">{bookTitle}</span>
      </div>
      <div className="notebook-chrome__actions">
        <button
          type="button"
          className="notebook-chrome__action"
          onClick={onExport}
          disabled={!canExport}
          aria-label="Export notebook"
          title={canExport ? undefined : 'No entries to export'}
        >
          Export
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/features/annotations/notebook/notebook-chrome.css`:

```css
.notebook-chrome__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.notebook-chrome__action {
  background: transparent;
  border: 0;
  padding: 4px 12px;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  transition: color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.notebook-chrome__action:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-hover, var(--color-surface));
}

.notebook-chrome__action:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.notebook-chrome__action:disabled {
  color: var(--color-text-subtle);
  cursor: not-allowed;
}
```

- [ ] **Step 5: Update existing tests that supply NotebookChrome props**

The existing `NotebookChrome.test.tsx` tests render `<NotebookChrome bookTitle={...} onBack={...} />` without `onExport` and `canExport`. Under TypeScript strict mode they may flag a missing-required-prop error. Update those tests to supply the new props:

```bash
grep -n "<NotebookChrome" src/features/annotations/notebook/NotebookChrome.test.tsx
```

For each existing render call, add `onExport={() => undefined}` and `canExport={true}` (or `false` if the test cares about disabled state). The behavior under test is unchanged; the props are just satisfied.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/features/annotations/notebook/NotebookChrome.test.tsx`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/features/annotations/notebook/NotebookChrome.tsx \
        src/features/annotations/notebook/NotebookChrome.test.tsx \
        src/features/annotations/notebook/notebook-chrome.css
git commit -m "$(cat <<'EOF'
feat(notebook): NotebookChrome Export button (Phase 7)

Adds a top-right "Export" button to the notebook chrome.
Disabled with title="No entries to export" when canExport=false.
aria-label="Export notebook" for screen readers. Reuses
design-system tokens for hover/focus/disabled states.

Not yet wired to actually export — that lands in Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the export in NotebookView (integration)

**Files:**
- Modify: `src/features/annotations/notebook/NotebookView.tsx`
- Modify: `src/features/annotations/notebook/NotebookView.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Read the existing test file to mirror its setup pattern:

```bash
head -30 src/features/annotations/notebook/NotebookView.test.tsx
```

Append a new test (inside the existing `describe('NotebookView', () => { ... })`):

```tsx
  it('clicking Export downloads a Markdown file containing the book title', async () => {
    const triggerDownload = await import('./triggerDownload');
    const downloadSpy = vi
      .spyOn(triggerDownload, 'triggerDownload')
      .mockImplementation(() => undefined);

    // Use whichever fakeBookmarksRepo / fakeHighlightsRepo / fakeNotesRepo
    // factories the existing tests use; supply a non-empty entries set so
    // canExport=true and the click actually fires.
    // (See sibling tests above for the exact factory signatures.)
    render(
      <NotebookView
        bookId="b1"
        bookTitle="Pride and Prejudice"
        bookmarksRepo={makeBookmarksRepoWithOne()}
        highlightsRepo={makeEmptyHighlightsRepo()}
        notesRepo={makeEmptyNotesRepo()}
        onBack={() => undefined}
        onJumpToAnchor={() => undefined}
      />,
    );

    // Wait for entries to load (existing tests likely use waitFor).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export notebook/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /export notebook/i }));

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const [content, filename] = downloadSpy.mock.calls[0]!;
    expect(content).toContain('# Pride and Prejudice');
    expect(filename).toBe('pride-and-prejudice-notebook.md');
  });
```

The factory function names (`makeBookmarksRepoWithOne`, etc.) must match what the existing test file already declares. Read the file first:

```bash
grep -n "function fake\|function make" src/features/annotations/notebook/NotebookView.test.tsx
```

Adjust the factory invocations to match. Imports at top of file may also need updates (`vi`, `waitFor`, `fireEvent`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/annotations/notebook/NotebookView.test.tsx`
Expected: new test FAILS — `onExport`/`canExport` not wired into `NotebookChrome` from `NotebookView`.

- [ ] **Step 3: Wire the export in `NotebookView.tsx`**

Update `src/features/annotations/notebook/NotebookView.tsx`:

```tsx
import { useCallback } from 'react';
import { BookId, type LocationAnchor } from '@/domain';
import type {
  BookmarksRepository,
  HighlightsRepository,
  NotesRepository,
  SavedAnswersRepository,
} from '@/storage';
import { NotebookChrome } from './NotebookChrome';
import { NotebookSearchBar } from './NotebookSearchBar';
import { NotebookList } from './NotebookList';
import { NotebookEmptyState } from './NotebookEmptyState';
import { useNotebook } from './useNotebook';
import { exportNotebookToMarkdown, slugifyTitle } from './exportMarkdown';
import { triggerDownload } from './triggerDownload';
import './notebook-view.css';

type Props = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly notesRepo: NotesRepository;
  readonly savedAnswersRepo?: SavedAnswersRepository;
  readonly onBack: () => void;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
};

export function NotebookView(props: Props) {
  const notebook = useNotebook({
    bookId: BookId(props.bookId),
    bookmarksRepo: props.bookmarksRepo,
    highlightsRepo: props.highlightsRepo,
    notesRepo: props.notesRepo,
    ...(props.savedAnswersRepo ? { savedAnswersRepo: props.savedAnswersRepo } : {}),
  });

  const handleExport = useCallback(() => {
    const md = exportNotebookToMarkdown({
      bookTitle: props.bookTitle,
      entries: notebook.entries,
    });
    triggerDownload(md, `${slugifyTitle(props.bookTitle)}-notebook.md`);
  }, [notebook.entries, props.bookTitle]);

  return (
    <div className="notebook-view">
      <NotebookChrome
        bookTitle={props.bookTitle}
        onBack={props.onBack}
        onExport={handleExport}
        canExport={notebook.entries.length > 0}
      />
      <NotebookSearchBar
        query={notebook.query}
        onQueryChange={notebook.setQuery}
        filter={notebook.filter}
        onFilterChange={notebook.setFilter}
      />
      {notebook.entries.length === 0 ? (
        <NotebookEmptyState
          reason={notebook.totalCount === 0 ? 'no-entries' : 'no-matches'}
        />
      ) : (
        <NotebookList
          entries={notebook.entries}
          onJumpToAnchor={props.onJumpToAnchor}
          onRemoveBookmark={(b) => {
            void notebook.removeBookmark(b);
          }}
          onRemoveHighlight={(h) => {
            void notebook.removeHighlight(h);
          }}
          onChangeColor={(h, color) => {
            void notebook.changeColor(h, color);
          }}
          onSaveNote={(h, content) => {
            void notebook.saveNote(h, content);
          }}
          onRemoveSavedAnswer={(id) => {
            void notebook.removeSavedAnswer(id);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/annotations/notebook/NotebookView.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Run full quality gate**

Run: `pnpm check`
Expected: green. ~1029 unit tests (1018 prior + 13 export + 3 download + 3 chrome + 1 view = 1038 if the math is exact; allow ±5 for test count drift).

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookView.tsx \
        src/features/annotations/notebook/NotebookView.test.tsx
git commit -m "$(cat <<'EOF'
feat(notebook): wire Export button to download Markdown (Phase 7)

NotebookView now derives canExport from notebook.entries.length and
provides handleExport that calls exportNotebookToMarkdown +
triggerDownload with a slugified filename. The Export button in
NotebookChrome is fully functional.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mark roadmap, verify, push, open PR

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Mark Phase 7 export-notebook complete**

In `docs/04-implementation-roadmap.md`, after the `Phase 6.3 — complete (2026-05-09)` line, add:

```markdown
- Phase 7 export-notebook — complete (2026-05-XX)
```

(Replace `XX` with today's date.)

- [ ] **Step 2: Final quality gate**

Run: `pnpm check`
Expected: green.

- [ ] **Step 3: Final e2e**

Run: `pnpm build && pnpm test:e2e`
Expected: 85 passed, 6 skipped. The Export button is a new affordance in `NotebookChrome`; no existing e2e asserts on its absence, so no regressions expected. The notebook flows in `notebook-edit-inline.spec.ts` etc. exercise the chrome and would catch a structural regression.

- [ ] **Step 4: Commit roadmap**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark Phase 7 export-notebook complete

First Phase 7 candidate landed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin phase-7-export-notebook
gh pr create --title "feat: Phase 7 — export notebook to Markdown" --body "$(cat <<'EOF'
## Summary

First Phase 7 candidate from the post-v1 deferred-exploration menu. Adds an "Export" button to the notebook chrome that downloads a Markdown file containing the user's bookmarks, highlights (with notes), and saved AI answers for the active book.

**Local-first:** the markdown blob is constructed in memory and downloaded via the browser's standard `<a download>` mechanism. No upload, no third-party services.

**Shape:**
- `exportMarkdown.ts` — pure serializer: `NotebookEntry[]` → CommonMark string. Three sections (Bookmarks / Highlights / Saved AI answers); empty groups omit their headings. User content rendered inside blockquotes so markdown specials don't break downstream renderers. Highlights group dedupes consecutive same-section headings.
- `triggerDownload.ts` — tiny isolated helper for the standard "create blob, click anchor" download flow.
- `NotebookChrome` gains a top-right "Export" button. Disabled with title tooltip when there are no entries to export. `aria-label="Export notebook"`.
- `NotebookView` derives `canExport` from `notebook.entries.length > 0` and wires the click.

**Scope:** exports the *currently-filtered + searched* view. User shapes the export through existing filter/search UI; no separate export-time selection.

**Filename:** slugified book title + `-notebook.md` (e.g., `pride-and-prejudice-notebook.md`).

## Test plan
- [x] `pnpm check` green (~1038 unit tests, +20 new)
- [x] `pnpm test:e2e` green (85 passed, 6 skipped)
- [x] `exportNotebookToMarkdown` 8 cases: empty, single bookmark, single highlight ±note, single saved answer with sources, mixed entries, section-heading dedupe, markdown-special-char scoping
- [x] `slugifyTitle` 5 cases: lowercase + dash, repeated dashes, trim, empty fallback, digit preservation
- [x] `triggerDownload` 3 cases: blob MIME, download attribute, cleanup
- [x] `NotebookChrome` 3 new cases: enabled / disabled / click invokes onExport
- [x] `NotebookView` 1 integration case: click downloads Markdown with correct content + filename

## Out of scope
- JSON / round-trip import (different feature; defer until backup/sync use case)
- HTML / PDF / EPUB export
- Multi-book export (Library concern, not Notebook)
- In-app preview before download
- Highlight tags (currently unused in UI)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done definition

- All 5 tasks complete with their commits.
- `exportNotebookToMarkdown` and `slugifyTitle` exposed from `exportMarkdown.ts`.
- `triggerDownload` exposed from `triggerDownload.ts`.
- `NotebookChrome` has an Export button with correct enabled/disabled behavior.
- `NotebookView` wires the click to `triggerDownload(exportNotebookToMarkdown(...), slugified-filename)`.
- `pnpm check` green; `pnpm test:e2e` green.
- Roadmap marks `Phase 7 export-notebook — complete (YYYY-MM-DD)`.
- PR opened.
