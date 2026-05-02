export function normalizeForSearch(s: string): string {
  return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function matchesQuery(
  query: string,
  haystacks: readonly (string | undefined)[],
): boolean {
  const q = normalizeForSearch(query.trim());
  if (q.length === 0) return true;
  for (const haystack of haystacks) {
    if (haystack && normalizeForSearch(haystack).includes(q)) return true;
  }
  return false;
}
