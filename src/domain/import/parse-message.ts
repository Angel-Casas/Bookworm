import type { BookFormat } from '../book/types';

export type ParsedMetadata = {
  readonly format: BookFormat;
  readonly title: string;
  readonly author?: string;
  readonly pageOrChapterCount?: number;
  readonly cover?: { readonly bytes: ArrayBuffer; readonly mimeType: string };
};

export type ParseRequest = {
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
  readonly originalName: string;
};

export type ParseResponse =
  | { readonly kind: 'ok'; readonly metadata: ParsedMetadata }
  | { readonly kind: 'error'; readonly reason: string };
