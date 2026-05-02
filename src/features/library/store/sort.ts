import type { Book, SortKey } from '@/domain';

type Cmp = (a: Book, b: Book) => number;

const byString = (a: string | undefined, b: string | undefined): number => {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
};

const recentlyOpened: Cmp = (a, b) => {
  if (a.lastOpenedAt === undefined && b.lastOpenedAt === undefined) {
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  }
  if (a.lastOpenedAt === undefined) return 1;
  if (b.lastOpenedAt === undefined) return -1;
  return (
    b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
};

const recentlyAdded: Cmp = (a, b) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

const byTitle: Cmp = (a, b) =>
  byString(a.title, b.title) || b.createdAt.localeCompare(a.createdAt);

const byAuthor: Cmp = (a, b) =>
  byString(a.author, b.author) || byString(a.title, b.title) || a.id.localeCompare(b.id);

const COMPARATORS: Readonly<Record<SortKey, Cmp>> = {
  'recently-opened': recentlyOpened,
  'recently-added': recentlyAdded,
  title: byTitle,
  author: byAuthor,
};

export function compareBooks(key: SortKey): Cmp {
  return COMPARATORS[key];
}
