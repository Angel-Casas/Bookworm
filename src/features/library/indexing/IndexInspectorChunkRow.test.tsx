import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IndexInspectorChunkRow } from './IndexInspectorChunkRow';
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';

afterEach(cleanup);

function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  return {
    id: ChunkId('c1'),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Chapter 1',
    text: 'It is a truth universally acknowledged.',
    normalizedText: 'It is a truth universally acknowledged.',
    tokenEstimate: 12,
    locationAnchor: { kind: 'epub-cfi', cfi: '/abc' },
    checksum: 'x',
    chunkerVersion: 1,
    ...overrides,
  };
}

describe('IndexInspectorChunkRow', () => {
  it('shows index, section title, token estimate, and a preview', () => {
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk()}
        index={0}
        total={87}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/#1 of 87/)).toBeInTheDocument();
    expect(screen.getByText(/Chapter 1/)).toBeInTheDocument();
    expect(screen.getByText(/~12 tk/)).toBeInTheDocument();
    expect(screen.getByText(/truth universally acknowledged/)).toBeInTheDocument();
  });

  it('truncates the preview to ~80 chars with ellipsis when text is long', () => {
    const long = 'x'.repeat(200);
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk({ normalizedText: long })}
        index={0}
        total={1}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/x{60,80}…/)).toBeInTheDocument();
  });

  it('clicking the row toggles expansion', () => {
    const onToggle = vi.fn();
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk()}
        index={0}
        total={1}
        expanded={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('expanded shows the full normalizedText and aria-expanded=true', () => {
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk()}
        index={0}
        total={1}
        expanded={true}
        onToggle={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('It is a truth universally acknowledged.')).toBeInTheDocument();
  });
});
