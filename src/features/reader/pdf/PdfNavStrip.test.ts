import { describe, it, expect, vi, afterEach } from 'vitest';
import { PdfNavStrip } from './PdfNavStrip';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PdfNavStrip', () => {
  it('renders Prev / indicator / Next in paginated mode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 1,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    expect(host.textContent).toContain('Page 1 of 5');
    expect(host.querySelector('button[data-action="prev"]')).not.toBeNull();
    expect(host.querySelector('button[data-action="next"]')).not.toBeNull();
  });

  it('renders only the indicator in scroll mode', () => {
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'scroll',
      pageCount: 5,
      currentPage: 3,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    expect(host.textContent).toContain('Page 3 of 5');
    expect(host.querySelector('button[data-action="prev"]')).toBeNull();
    expect(host.querySelector('button[data-action="next"]')).toBeNull();
  });

  it('disables Prev on page 1 and Next on last page', () => {
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 1,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    expect((host.querySelector<HTMLButtonElement>('button[data-action="prev"]')!).disabled).toBe(
      true,
    );
    expect((host.querySelector<HTMLButtonElement>('button[data-action="next"]')!).disabled).toBe(
      false,
    );
    strip.update({ currentPage: 5 });
    expect((host.querySelector<HTMLButtonElement>('button[data-action="prev"]')!).disabled).toBe(
      false,
    );
    expect((host.querySelector<HTMLButtonElement>('button[data-action="next"]')!).disabled).toBe(
      true,
    );
  });

  it('fires callbacks on click', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 3,
      onPrev,
      onNext,
    });
    strip.render();
    (host.querySelector<HTMLButtonElement>('button[data-action="prev"]')!).click();
    (host.querySelector<HTMLButtonElement>('button[data-action="next"]')!).click();
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('destroy removes its DOM', () => {
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 3,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    strip.destroy();
    expect(host.querySelector('button[data-action="prev"]')).toBeNull();
  });
});
