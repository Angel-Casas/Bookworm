import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import { MultiExcerptChip } from './MultiExcerptChip';

afterEach(cleanup);

const mk = (i: number, sectionTitle: string, text: string): AttachedExcerpt => ({
  id: `h:${String(i)}`,
  sourceKind: 'highlight',
  highlightId: HighlightId(`h${String(i)}`),
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/4!/4/${String(i)})` },
  sectionTitle,
  text,
  addedAt: IsoTimestamp('2026-05-08T00:00:00.000Z'),
});

const baseProps = {
  excerpts: [mk(2, 'Ch I', 'AAA'), mk(4, 'Ch II', 'BBB')] as readonly AttachedExcerpt[],
  onClear: vi.fn(),
  onRemoveExcerpt: vi.fn(),
  onJumpToExcerpt: vi.fn(),
};

describe('MultiExcerptChip', () => {
  it('renders a count summary collapsed by default', () => {
    render(<MultiExcerptChip {...baseProps} />);
    const toggle = screen.getByRole('button', { name: /excerpts/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking the count toggles expansion', () => {
    render(<MultiExcerptChip {...baseProps} />);
    const toggle = screen.getByRole('button', { name: /excerpts/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/^Ch I$/)).toBeInTheDocument();
    expect(screen.getByText(/^Ch II$/)).toBeInTheDocument();
  });

  it('per-row × calls onRemoveExcerpt with the row id', () => {
    const onRemoveExcerpt = vi.fn();
    render(<MultiExcerptChip {...baseProps} onRemoveExcerpt={onRemoveExcerpt} />);
    fireEvent.click(screen.getByRole('button', { name: /excerpts/i }));
    const removeButtons = screen.getAllByRole('button', { name: /Remove from compare/ });
    fireEvent.click(removeButtons[0]!);
    expect(onRemoveExcerpt).toHaveBeenCalledWith('h:2');
  });

  it('per-row jump calls onJumpToExcerpt with the anchor', () => {
    const onJumpToExcerpt = vi.fn();
    render(<MultiExcerptChip {...baseProps} onJumpToExcerpt={onJumpToExcerpt} />);
    fireEvent.click(screen.getByRole('button', { name: /excerpts/i }));
    const jumpButtons = screen.getAllByRole('button', { name: /Jump to/ });
    fireEvent.click(jumpButtons[0]!);
    expect(onJumpToExcerpt).toHaveBeenCalledWith(baseProps.excerpts[0]!.anchor);
  });

  it('wrapper × calls onClear', () => {
    const onClear = vi.fn();
    render(<MultiExcerptChip {...baseProps} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear compare set/ }));
    expect(onClear).toHaveBeenCalled();
  });

  it('renders nothing when excerpts is empty', () => {
    const { container } = render(<MultiExcerptChip {...baseProps} excerpts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
