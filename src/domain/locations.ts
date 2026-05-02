// Format-agnostic pointer into a book. EPUB anchors use CFI strings; PDF
// anchors are page-based. Adapters translate to/from this domain shape so
// reader-engine specifics never leak into storage or AI logic.

export type LocationAnchor =
  | { readonly kind: 'epub-cfi'; readonly cfi: string }
  | {
      readonly kind: 'pdf';
      readonly page: number;
      readonly offset?: number;
      readonly rect?: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
    };

export type LocationRange = {
  readonly start: LocationAnchor;
  readonly end: LocationAnchor;
};
