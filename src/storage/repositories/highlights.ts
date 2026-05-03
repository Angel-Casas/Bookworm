import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type {
  Highlight,
  HighlightAnchor,
  HighlightColor,
  HighlightRect,
} from '@/domain/annotations/types';
import { compareHighlightsInBookOrder } from '@/features/reader/workspace/highlightSort';
import type { BookwormDB } from '../db/open';
import { HIGHLIGHTS_STORE } from '../db/schema';

export type HighlightsRepository = {
  add(highlight: Highlight): Promise<void>;
  patch(id: HighlightId, partial: Partial<Pick<Highlight, 'color'>>): Promise<void>;
  delete(id: HighlightId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Highlight[]>;
  deleteByBook(bookId: BookId): Promise<void>;
};

const VALID_COLORS: ReadonlySet<HighlightColor> = new Set([
  'yellow',
  'green',
  'blue',
  'pink',
]);

function isValidRect(v: unknown): v is HighlightRect {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<HighlightRect>;
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number'
  );
}

function isValidAnchor(value: unknown): value is HighlightAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'epub-cfi') {
    return typeof (value as { cfi?: unknown }).cfi === 'string';
  }
  if (v.kind === 'pdf') {
    const p = value as { page?: unknown; rects?: unknown };
    return (
      typeof p.page === 'number' && Array.isArray(p.rects) && p.rects.every(isValidRect)
    );
  }
  return false;
}

function normalizeHighlight(record: unknown): Highlight | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Highlight>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidAnchor(r.anchor)) return null;
  if (typeof r.selectedText !== 'string') return null;
  if (typeof r.color !== 'string' || !VALID_COLORS.has(r.color as HighlightColor)) return null;
  if (typeof r.createdAt !== 'string') return null;
  return {
    id: HighlightId(r.id),
    bookId: BookId(r.bookId),
    anchor: r.anchor,
    selectedText: r.selectedText,
    sectionTitle: typeof r.sectionTitle === 'string' ? r.sectionTitle : null,
    color: r.color,
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === 'string')
      : [],
    createdAt: IsoTimestamp(r.createdAt),
  };
}

export function createHighlightsRepository(db: BookwormDB): HighlightsRepository {
  return {
    async add(highlight) {
      await db.put(HIGHLIGHTS_STORE, highlight);
    },
    async patch(id, partial) {
      const existing = await db.get(HIGHLIGHTS_STORE, id);
      if (!existing) return;
      const next: Highlight = { ...existing, ...partial };
      await db.put(HIGHLIGHTS_STORE, next);
    },
    async delete(id) {
      await db.delete(HIGHLIGHTS_STORE, id);
    },
    async listByBook(bookId) {
      const tx = db.transaction(HIGHLIGHTS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      const valid = records
        .map(normalizeHighlight)
        .filter((h): h is Highlight => h !== null);
      return valid.sort(compareHighlightsInBookOrder);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(HIGHLIGHTS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
