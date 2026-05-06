import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIndexing } from './useIndexing';
import { BookId } from '@/domain';

function makeStubs() {
  return {
    booksRepo: {
      getById: vi.fn(() => Promise.resolve(undefined)),
      getAll: vi.fn(() => Promise.resolve([])),
      put: vi.fn(() => Promise.resolve()),
      findByChecksum: vi.fn(() => Promise.resolve(undefined)),
      delete: vi.fn(() => Promise.resolve()),
    },
    chunksRepo: {
      countStaleVersions: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
      upsertMany: vi.fn(() => Promise.resolve()),
      hasChunksFor: vi.fn(() => Promise.resolve(false)),
      countByBook: vi.fn(() => Promise.resolve(0)),
      listByBook: vi.fn(() => Promise.resolve([])),
      listBySection: vi.fn(() => Promise.resolve([])),
      deleteBySection: vi.fn(() => Promise.resolve()),
    },
    epubExtractor: {
      listSections: vi.fn(() => Promise.resolve([])),
      // eslint-disable-next-line require-yield
      streamParagraphs: vi.fn(async function* (): AsyncGenerator<never> {
        await Promise.resolve();
        return;
      }),
    },
    pdfExtractor: {
      listSections: vi.fn(() => Promise.resolve([])),
      // eslint-disable-next-line require-yield
      streamParagraphs: vi.fn(async function* (): AsyncGenerator<never> {
        await Promise.resolve();
        return;
      }),
    },
  };
}

describe('useIndexing', () => {
  it('runs onAppOpen exactly once on mount', async () => {
    const stubs = makeStubs();
    renderHook(() => useIndexing(stubs as never));
    await new Promise((r) => setTimeout(r, 50));
    expect(stubs.chunksRepo.countStaleVersions).toHaveBeenCalledTimes(1);
    expect(stubs.booksRepo.getAll).toHaveBeenCalledTimes(1);
  });

  it('exposes enqueue/rebuild/cancel methods', () => {
    const stubs = makeStubs();
    const { result } = renderHook(() => useIndexing(stubs as never));
    expect(typeof result.current.enqueue).toBe('function');
    expect(typeof result.current.rebuild).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
  });

  it('enqueue dispatches to the underlying queue', async () => {
    const stubs = makeStubs();
    const { result } = renderHook(() => useIndexing(stubs as never));
    result.current.enqueue(BookId('b1'));
    await new Promise((r) => setTimeout(r, 50));
    expect(stubs.booksRepo.getById).toHaveBeenCalledWith(BookId('b1'));
  });
});
