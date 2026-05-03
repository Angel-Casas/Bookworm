import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TocPanel } from './TocPanel';
import type { TocEntry } from '@/domain';
import { SectionId } from '@/domain';

const TOC: readonly TocEntry[] = [
  { id: SectionId('c1'), title: 'Chapter 1', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'a' } },
  {
    id: SectionId('c1-1'),
    title: 'Section 1.1',
    depth: 1,
    anchor: { kind: 'epub-cfi', cfi: 'b' },
  },
  { id: SectionId('c2'), title: 'Chapter 2', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'c' } },
];

afterEach(cleanup);

describe('TocPanel', () => {
  it('renders all entries with depth-based indentation', () => {
    render(<TocPanel toc={TOC} onSelect={() => undefined} />);
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('Section 1.1')).toBeDefined();
    expect(screen.getByText('Chapter 2')).toBeDefined();
    const section = screen.getByText('Section 1.1').closest('button');
    expect(section?.style.paddingInlineStart).toBe('32px');
  });

  it('fires onSelect with the clicked entry', () => {
    const onSelect = vi.fn();
    render(<TocPanel toc={TOC} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Chapter 2'));
    expect(onSelect).toHaveBeenCalledWith(TOC[2]);
  });

  it('marks the current entry visually', () => {
    render(<TocPanel toc={TOC} currentEntryId={String(TOC[1]?.id)} onSelect={() => undefined} />);
    const sectionBtn = screen.getByText('Section 1.1').closest('button');
    expect(sectionBtn?.className).toContain('toc-panel__entry--current');
  });

  it('shows an empty-state when toc is empty', () => {
    render(<TocPanel toc={[]} onSelect={() => undefined} />);
    expect(screen.getByText(/no chapters/i)).toBeDefined();
  });
});
