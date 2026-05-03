// Minimal ambient declarations for foliate-js (no upstream types).
// Only the surface our EpubReaderAdapter actually uses is declared.
// Keep this file as small as possible — every entry here is a lock-in
// against the foliate-js API.

declare module 'foliate-js/view.js' {
  // The module is imported for its side effect of registering the
  // <foliate-view> custom element. There are no class exports we use.
  export {};
}

declare global {
  interface FoliateBookTocItem {
    readonly label: string;
    readonly href: string;
    readonly subitems?: readonly FoliateBookTocItem[];
  }

  interface FoliateBook {
    readonly toc?: readonly FoliateBookTocItem[];
  }

  interface FoliateRenderer extends HTMLElement {
    setStyles?(css: string): void;
  }

  interface FoliateLastLocation {
    readonly cfi?: string;
  }

  interface FoliateRelocateEvent extends CustomEvent {
    readonly detail: { readonly cfi?: string } & Record<string, unknown>;
  }

  // The custom element registered by foliate-js/view.js. We only declare the
  // methods and properties we actually call.
  interface FoliateViewElement extends HTMLElement {
    open(book: Blob | string | object): Promise<void>;
    close(): void;
    init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<void>;
    readonly book?: FoliateBook;
    readonly renderer?: FoliateRenderer;
    lastLocation?: FoliateLastLocation | null;
    addEventListener(
      type: 'relocate',
      listener: (e: FoliateRelocateEvent) => void,
      options?: AddEventListenerOptions | boolean,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ): void;
  }

  interface HTMLElementTagNameMap {
    'foliate-view': FoliateViewElement;
  }
}

export {};
