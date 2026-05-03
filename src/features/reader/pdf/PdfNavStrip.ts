import type { ReaderMode } from '@/domain/reader';

type Options = {
  readonly host: HTMLElement;
  readonly mode: ReaderMode;
  readonly pageCount: number;
  readonly currentPage: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
};

export class PdfNavStrip {
  private root: HTMLDivElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private indicator: HTMLSpanElement | null = null;
  private mode: ReaderMode;
  private pageCount: number;
  private currentPage: number;

  constructor(private readonly opts: Options) {
    this.mode = opts.mode;
    this.pageCount = opts.pageCount;
    this.currentPage = opts.currentPage;
  }

  render(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.className = 'pdf-reader__nav-strip';

    if (this.mode === 'paginated') {
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.dataset.action = 'prev';
      prev.textContent = '← Prev';
      prev.addEventListener('click', this.opts.onPrev);
      this.prevBtn = prev;
      root.appendChild(prev);
    }

    const indicator = document.createElement('span');
    indicator.className = 'pdf-reader__nav-strip__indicator';
    this.indicator = indicator;
    root.appendChild(indicator);

    if (this.mode === 'paginated') {
      const next = document.createElement('button');
      next.type = 'button';
      next.dataset.action = 'next';
      next.textContent = 'Next →';
      next.addEventListener('click', this.opts.onNext);
      this.nextBtn = next;
      root.appendChild(next);
    }

    this.opts.host.appendChild(root);
    this.root = root;
    this.refresh();
  }

  update(patch: Partial<{ mode: ReaderMode; pageCount: number; currentPage: number }>): void {
    const modeChanged = patch.mode !== undefined && patch.mode !== this.mode;
    if (patch.mode !== undefined) this.mode = patch.mode;
    if (patch.pageCount !== undefined) this.pageCount = patch.pageCount;
    if (patch.currentPage !== undefined) this.currentPage = patch.currentPage;
    if (modeChanged && this.root) {
      // Mode change requires a re-render to add/remove the buttons.
      this.destroy();
      this.render();
      return;
    }
    this.refresh();
  }

  destroy(): void {
    if (!this.root) return;
    if (this.prevBtn) this.prevBtn.removeEventListener('click', this.opts.onPrev);
    if (this.nextBtn) this.nextBtn.removeEventListener('click', this.opts.onNext);
    this.root.remove();
    this.root = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.indicator = null;
  }

  private refresh(): void {
    if (this.indicator) {
      this.indicator.textContent = `Page ${String(this.currentPage)} of ${String(this.pageCount)}`;
    }
    if (this.prevBtn) this.prevBtn.disabled = this.currentPage <= 1;
    if (this.nextBtn) this.nextBtn.disabled = this.currentPage >= this.pageCount;
  }
}
