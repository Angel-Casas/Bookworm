import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DesktopRail } from './DesktopRail';
import type { TocEntry } from '@/domain';
import { SectionId } from '@/domain';

afterEach(cleanup);

const TOC: readonly TocEntry[] = [
  { id: SectionId('c1'), title: 'Chapter 1', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'a' } },
  { id: SectionId('c2'), title: 'Chapter 2', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'b' } },
];

describe('DesktopRail', () => {
  it('renders TOC entries inside an aside.desktop-rail container', () => {
    render(<DesktopRail toc={TOC} onSelect={() => undefined} />);
    expect(document.querySelector('aside.desktop-rail')).not.toBeNull();
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('Chapter 2')).toBeDefined();
  });

  it('forwards click to onSelect with the entry', () => {
    const onSelect = vi.fn();
    render(<DesktopRail toc={TOC} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Chapter 2'));
    expect(onSelect).toHaveBeenCalledWith(TOC[1]);
  });

  it('marks the current entry', () => {
    render(<DesktopRail toc={TOC} currentEntryId={String(TOC[0]?.id)} onSelect={() => undefined} />);
    const btn = screen.getByText('Chapter 1').closest('button');
    expect(btn?.className).toContain('toc-panel__entry--current');
  });
});
