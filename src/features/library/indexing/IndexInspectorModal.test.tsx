import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { IndexInspectorModal } from './IndexInspectorModal';
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';

afterEach(cleanup);

function makeChunks(n: number): TextChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    id: ChunkId(`c${String(i)}`),
    bookId: BookId('b1'),
    sectionId: SectionId(i < 3 ? 's1' : 's2'),
    sectionTitle: i < 3 ? 'Chapter 1' : 'Chapter 2',
    text: `Chunk ${String(i)}`,
    normalizedText: `Chunk ${String(i)} content`,
    tokenEstimate: 10 + i,
    locationAnchor: { kind: 'epub-cfi' as const, cfi: '/x' },
    checksum: 'x',
    chunkerVersion: 1,
  }));
}

function fakeChunksRepo(chunks: TextChunk[]) {
  return {
    listByBook: vi.fn(() => Promise.resolve(chunks)),
    upsertMany: vi.fn(() => Promise.resolve()),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteByBook: vi.fn(() => Promise.resolve()),
    deleteBySection: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(chunks.length)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    hasChunksFor: vi.fn(() => Promise.resolve(true)),
  };
}

function fakeEmbeddingsRepo() {
  return {
    upsertMany: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve([])),
    deleteByBook: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(0)),
    hasEmbeddingFor: vi.fn(() => Promise.resolve(false)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    deleteOrphans: vi.fn(() => Promise.resolve(0)),
  };
}

describe('IndexInspectorModal', () => {
  it('renders chunks with header counts derived from the chunk list', async () => {
    const chunks = makeChunks(5);
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(chunks) as never}
        embeddingsRepo={fakeEmbeddingsRepo() as never}
        onRebuild={vi.fn(() => Promise.resolve())}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/5 chunks · 2 sections/i)).toBeInTheDocument();
    });
  });

  it('Rebuild button calls onRebuild and closes the modal', async () => {
    const chunks = makeChunks(2);
    const onRebuild = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(chunks) as never}
        embeddingsRepo={fakeEmbeddingsRepo() as never}
        onRebuild={onRebuild}
        onClose={onClose}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/2 chunks/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }));
    await waitFor(() => {
      expect(onRebuild).toHaveBeenCalledWith(BookId('b1'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('ESC key closes the modal', () => {
    const onClose = vi.fn();
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(makeChunks(1)) as never}
        embeddingsRepo={fakeEmbeddingsRepo() as never}
        onRebuild={vi.fn(() => Promise.resolve())}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders role="dialog" with aria-modal', () => {
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(makeChunks(1)) as never}
        embeddingsRepo={fakeEmbeddingsRepo() as never}
        onRebuild={vi.fn(() => Promise.resolve())}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
