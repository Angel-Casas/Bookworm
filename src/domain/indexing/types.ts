export type IndexingStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'chunking'; readonly progressPercent: number }
  | { readonly kind: 'embedding'; readonly progressPercent: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export type AIProfileStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'generating' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };
