import type { RefreshErrorReason } from './modelCatalogStore';

export type CatalogErrorContext =
  | { readonly hasCache: false; readonly now: number }
  | { readonly hasCache: true; readonly fetchedAt: number; readonly now: number };

function relativeMinutes(fetchedAt: number, now: number): string {
  const diffMs = Math.max(0, now - fetchedAt);
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'less than a minute';
  if (mins === 1) return '1 min';
  if (mins < 60) return `${String(mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 h';
  if (hours < 24) return `${String(hours)} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${String(days)} days`;
}

export function messageForCatalogError(
  reason: RefreshErrorReason,
  ctx: CatalogErrorContext,
): string {
  if (!ctx.hasCache) {
    switch (reason) {
      case 'invalid-key':
        return 'NanoGPT rejected the key. Try removing it and entering it again.';
      case 'network':
        return "Couldn't reach NanoGPT. Check your connection and try Refresh again.";
      case 'other':
        return 'Unexpected response from NanoGPT. Try Refresh again.';
    }
  }
  const age = relativeMinutes(ctx.fetchedAt, ctx.now);
  switch (reason) {
    case 'invalid-key':
      return `Couldn't refresh — NanoGPT rejected the key. Using the last-known list (${age} old).`;
    case 'network':
      return `Couldn't refresh — network error. Using the last-known list (${age} old).`;
    case 'other':
      return `Couldn't refresh — unexpected error. Using the last-known list (${age} old).`;
  }
}
