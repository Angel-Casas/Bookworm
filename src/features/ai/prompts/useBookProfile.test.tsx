import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBookProfile } from './useBookProfile';
import {
  BookId,
  IsoTimestamp,
  SectionId,
  type Book,
  type BookProfileRecord,
  type TocEntry,
} from '@/domain';
import type { BookChunksRepository, BookProfilesRepository } from '@/storage';
import type { StructuredClient } from '@/features/ai/chat/nanogptStructured';

const sampleBook: Pick<Book, 'id' | 'title' | 'author' | 'toc'> = {
  id: BookId('b1'),
  title: 'T',
  author: 'A',
  toc: [
    {
      id: SectionId('s1'),
      title: 'Ch 1',
      anchor: { kind: 'epub-cfi', cfi: '/' },
      depth: 0,
    } satisfies TocEntry,
  ],
};

const cachedRecord: BookProfileRecord = {
  bookId: BookId('b1'),
  profile: {
    summary: 'cached',
    genre: 'g',
    structure: 'fiction',
    themes: ['t'],
    keyEntities: { characters: [], concepts: [], places: [] },
  },
  prompts: [
    { text: 'q1', category: 'analysis' },
    { text: 'q2', category: 'analysis' },
    { text: 'q3', category: 'analysis' },
    { text: 'q4', category: 'analysis' },
  ],
  profileSchemaVersion: 1,
  generatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
};

function makeDeps(overrides: {
  cached?: BookProfileRecord | null;
  chunks?: readonly { id: string }[];
  structuredResponse?: unknown;
  structuredThrows?: Error;
}): {
  chunksRepo: BookChunksRepository;
  profilesRepo: BookProfilesRepository;
  structuredClient: StructuredClient;
  putSpy: ReturnType<typeof vi.fn>;
} {
  const putSpy = vi.fn(() => Promise.resolve());
  const chunksRepo: BookChunksRepository = {
    upsertMany: () => Promise.resolve(),
    listByBook: () =>
      Promise.resolve(
        (overrides.chunks ?? [{ id: 'chunk-b1-s1-0' }]).map(
          (c) =>
            ({
              id: c.id,
              bookId: 'b1',
              sectionId: 's1',
              sectionTitle: 'Ch 1',
              text: 't',
              normalizedText: 't',
              tokenEstimate: 50,
              locationAnchor: { kind: 'epub-cfi', cfi: '/' },
              checksum: 'cs',
              chunkerVersion: 1,
            }) as never,
        ),
      ),
    listBySection: () => Promise.resolve([]),
    deleteByBook: () => Promise.resolve(),
    deleteBySection: () => Promise.resolve(),
    countByBook: () => Promise.resolve(1),
    countStaleVersions: () => Promise.resolve([]),
    hasChunksFor: () => Promise.resolve(true),
  };
  const profilesRepo: BookProfilesRepository = {
    get: () => Promise.resolve(overrides.cached ?? null),
    put: putSpy,
    deleteByBook: () => Promise.resolve(),
    countStaleVersions: () => Promise.resolve([]),
  };
  const structuredClient: StructuredClient = {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- generic required by StructuredClient interface contract
    complete<T>() {
      if (overrides.structuredThrows) return Promise.reject(overrides.structuredThrows);
      return Promise.resolve({
        value: (overrides.structuredResponse ?? {
          profile: {
            summary: 's',
            genre: 'g',
            structure: 'fiction',
            themes: ['t'],
            keyEntities: { characters: [], concepts: [], places: [] },
          },
          prompts: [
            { text: 'a', category: 'analysis' },
            { text: 'b', category: 'analysis' },
            { text: 'c', category: 'analysis' },
            { text: 'd', category: 'analysis' },
          ],
        }) as T,
      });
    },
  };
  return { chunksRepo, profilesRepo, structuredClient, putSpy };
}

describe('useBookProfile', () => {
  it('cached read short-circuits — status: ready, no put call', async () => {
    const deps = makeDeps({ cached: cachedRecord });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status === 'ready') {
      expect(result.current.record.profile.summary).toBe('cached');
    }
    expect(deps.putSpy).not.toHaveBeenCalled();
  });

  it('cache miss triggers generation — idle → loading → ready, persists record', async () => {
    const deps = makeDeps({ cached: null });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(deps.putSpy).toHaveBeenCalledTimes(1);
  });

  it('enabled: false keeps state in idle', async () => {
    const deps = makeDeps({ cached: null });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: false,
        deps,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.status).toBe('idle');
    expect(deps.putSpy).not.toHaveBeenCalled();
  });

  it('returns no-chunks when book has zero chunks', async () => {
    const deps = makeDeps({ cached: null, chunks: [] });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('no-chunks');
    });
  });

  it('returns failed when structuredClient throws', async () => {
    const { StructuredError } = await import('@/features/ai/chat/nanogptStructured');
    const deps = makeDeps({
      cached: null,
      structuredThrows: new StructuredError({ reason: 'rate-limit', status: 429 }),
    });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    if (result.current.status === 'failed') {
      expect(result.current.reason).toBe('rate-limit');
    }
  });

  it('retry from failed re-runs generation', async () => {
    const deps = makeDeps({ cached: null });
    let callCount = 0;
    deps.structuredClient = {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- generic required by StructuredClient interface contract
      complete<T>() {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(new Error('first-call boom'));
        }
        return Promise.resolve({
          value: {
            profile: {
              summary: 's',
              genre: 'g',
              structure: 'fiction',
              themes: ['t'],
              keyEntities: { characters: [], concepts: [], places: [] },
            },
            prompts: [
              { text: 'a', category: 'analysis' },
              { text: 'b', category: 'analysis' },
              { text: 'c', category: 'analysis' },
              { text: 'd', category: 'analysis' },
            ],
          } as T,
        });
      },
    };
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(callCount).toBe(2);
  });

  it('modelId === null keeps state in idle (waits for model selection)', async () => {
    const deps = makeDeps({ cached: null });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: null,
        enabled: true,
        deps,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.status).toBe('idle');
  });
});
