// Reader-specific domain types.
//
// LocationAnchor lives in src/domain/locations.ts and TocEntry lives in
// src/domain/book/types.ts (both shipped in Phase 1). This module imports
// them for use here but does NOT re-export — consumers import them from
// '@/domain' directly. We only export reader-only types from this module.

import type { LocationAnchor, TocEntry } from '@/domain';

// ----- Reader preferences -----

export type ReaderFontFamily =
  | 'system-serif'
  | 'system-sans'
  | 'georgia'
  | 'iowan'
  | 'inter';

export type ReaderTheme = 'light' | 'dark' | 'sepia';
export type ReaderMode = 'scroll' | 'paginated';
export type FocusMode = 'normal' | 'focus';

export type ReaderTypography = {
  readonly fontFamily: ReaderFontFamily;
  readonly fontSizeStep: 0 | 1 | 2 | 3 | 4;
  readonly lineHeightStep: 0 | 1 | 2;
  readonly marginStep: 0 | 1 | 2;
};

export type ReaderPreferences = {
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly modeByFormat: { readonly epub: ReaderMode; readonly pdf: ReaderMode };
  readonly focusMode: FocusMode;
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  typography: {
    fontFamily: 'system-serif',
    fontSizeStep: 2,
    lineHeightStep: 1,
    marginStep: 1,
  },
  theme: 'light',
  modeByFormat: { epub: 'paginated', pdf: 'paginated' },
  focusMode: 'normal',
};

// ----- BookReader contract (just-in-time minimal API) -----

export type ReaderInitOptions = {
  readonly preferences: ReaderPreferences;
  readonly initialAnchor?: LocationAnchor;
};

export type LocationChangeListener = (anchor: LocationAnchor) => void;

export interface BookReader {
  open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }>;
  goToAnchor(anchor: LocationAnchor): Promise<void>;
  getCurrentAnchor(): LocationAnchor;
  applyPreferences(prefs: ReaderPreferences): void;
  onLocationChange(listener: LocationChangeListener): () => void;
  destroy(): void;
}

// ----- Errors -----

export type ReaderError =
  | { readonly kind: 'blob-missing'; readonly bookId: string }
  | { readonly kind: 'parse-failed'; readonly reason: string }
  | { readonly kind: 'unsupported-format'; readonly format: string }
  | { readonly kind: 'engine-crashed'; readonly cause: unknown };
