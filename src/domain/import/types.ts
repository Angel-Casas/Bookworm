export type ImportStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'parsing'; readonly progressPercent: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export type SourceKind = 'imported-file' | 'linked-folder';

export type SourceRef = {
  readonly kind: SourceKind;
  readonly opfsPath: string;
  readonly originalName: string;
  readonly byteSize: number;
  readonly mimeType: string;
};
