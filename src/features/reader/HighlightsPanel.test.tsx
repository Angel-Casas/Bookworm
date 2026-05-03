import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HighlightsPanel } from './HighlightsPanel';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';

afterEach(cleanup);

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function h(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)' },
    selectedText: 'A passage of selected text',
    sectionTitle: 'Chapter 1',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    ...overrides,
  };
}

describe('HighlightsPanel', () => {
  it('renders rows with section + selected text + relative time + colored bar', () => {
    const { container } = render(
      <HighlightsPanel
        highlights={[h({ sectionTitle: 'Chapter 1' })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('A passage of selected text')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
    expect(container.querySelector('.highlights-panel__bar[data-color="yellow"]')).not.toBeNull();
  });

  it('shows empty state when no highlights', () => {
    render(
      <HighlightsPanel
        highlights={[]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
      />,
    );
    expect(screen.getByText(/No highlights yet/i)).toBeDefined();
  });

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn();
    const target = h();
    render(
      <HighlightsPanel
        highlights={[target]}
        onSelect={onSelect}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chapter 1/i }));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('calls onDelete when × is clicked', () => {
    const onDelete = vi.fn();
    const target = h();
    render(
      <HighlightsPanel
        highlights={[target]}
        onSelect={() => undefined}
        onDelete={onDelete}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove highlight/i));
    expect(onDelete).toHaveBeenCalledWith(target);
  });

  it('calls onChangeColor when a color pip is clicked', () => {
    const onChangeColor = vi.fn();
    const target = h({ color: 'yellow' });
    render(
      <HighlightsPanel
        highlights={[target]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={onChangeColor}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/set color to green/i));
    expect(onChangeColor).toHaveBeenCalledWith(target, 'green');
  });

  it('renders highlights in the order provided (caller sorts)', () => {
    const a = h({ sectionTitle: 'Alpha' });
    const b = h({ sectionTitle: 'Beta' });
    const c = h({ sectionTitle: 'Gamma' });
    render(
      <HighlightsPanel
        highlights={[c, a, b]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    const titles = Array.from(document.querySelectorAll('.highlights-panel__section')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Gamma', 'Alpha', 'Beta']);
  });
});
