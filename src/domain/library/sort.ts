export type SortKey = 'recently-opened' | 'recently-added' | 'title' | 'author';

export const ALL_SORT_KEYS: readonly SortKey[] = [
  'recently-opened',
  'recently-added',
  'title',
  'author',
];

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  'recently-opened': 'Recently opened',
  'recently-added': 'Recently added',
  title: 'Title (A–Z)',
  author: 'Author (A–Z)',
};

export const DEFAULT_SORT: SortKey = 'recently-opened';
