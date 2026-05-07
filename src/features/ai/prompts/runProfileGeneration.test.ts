import { describe, expect, it } from 'vitest';
import { runProfileGeneration } from './runProfileGeneration';
import {
  BookId,
  ChunkId,
  SectionId,
  type Book,
  type BookProfileRecord,
  type TextChunk,
  type TocEntry,
} from '@/domain';
import type { BookChunksRepository, BookProfilesRepository } from '@/storage';
import type { StructuredClient } from '@/features/ai/chat/nanogptStructured';
import { StructuredError } from '@/features/ai/chat/nanogptStructured';

function mkChunk(idx: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text: `chunk ${String(idx)}`,
    normalizedText: `chunk ${String(idx)}`,
    tokenEstimate: 50,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

const sampleBook: Pick<Book, 'id' | 'title' | 'author' | 'toc'> = {
  id: BookId('b1'),
  title: 'Test',
  author: 'Author',
  toc: [
    {
      id: SectionId('s1'),
      title: 'Ch 1',
      anchor: { kind: 'epub-cfi', cfi: '/6/2' },
      depth: 0,
    } satisfies TocEntry,
  ],
};

const validRawProfile = {
  profile: {
    summary: 'A short novel.',
    genre: 'classic',
    structure: 'fiction',
    themes: ['marriage'],
    keyEntities: { characters: ['Eliza'], concepts: [], places: [] },
  },
  prompts: [
    { text: 'Track motives.', category: 'analysis' },
    { text: 'Map relations.', category: 'structure' },
    { text: 'Foreshadow scenes.', category: 'analysis' },
    { text: 'Title meaning.', category: 'comprehension' },
  ],
};

function chunksRepoFromList(chunks: readonly TextChunk[]): BookChunksRepository {
  return {
    upsertMany: () => Promise.resolve(),
    listByBook: () => Promise.resolve(chunks),
    listBySection: () => Promise.resolve([]),
    deleteByBook: () => Promise.resolve(),
    deleteBySection: () => Promise.resolve(),
    countByBook: () => Promise.resolve(chunks.length),
    countStaleVersions: () => Promise.resolve([]),
    hasChunksFor: () => Promise.resolve(true),
  };
}

function profilesRepoStub(): BookProfilesRepository & {
  putCalls: BookProfileRecord[];
} {
  const putCalls: BookProfileRecord[] = [];
  return {
    putCalls,
    get: () => Promise.resolve(null),
    put: (r) => {
      putCalls.push(r);
      return Promise.resolve();
    },
    deleteByBook: () => Promise.resolve(),
    countStaleVersions: () => Promise.resolve([]),
  };
}

function structuredClientReturning(value: unknown): StructuredClient {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- generic required by StructuredClient interface contract
    complete: <T>() => Promise.resolve({ value: value as T }),
  };
}

function structuredClientThrowing(failure: StructuredError['failure']): StructuredClient {
  return {
    complete: () => Promise.reject(new StructuredError(failure)),
  };
}

describe('runProfileGeneration', () => {
  it('happy path persists record and returns ok', async () => {
    const profilesRepo = profilesRepoStub();
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo,
        structuredClient: structuredClientReturning(validRawProfile),
      },
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(profilesRepo.putCalls).toHaveLength(1);
    expect(result.record.profile.structure).toBe('fiction');
    expect(result.record.prompts).toHaveLength(4);
  });

  it('returns no-chunks when chunksRepo.listByBook is empty', async () => {
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientReturning(validRawProfile),
      },
    });
    expect(result.kind).toBe('no-chunks');
  });

  it('returns failed{invalid-key} when structuredClient throws invalid-key', async () => {
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientThrowing({
          reason: 'invalid-key',
          status: 401,
        }),
      },
    });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.reason).toBe('invalid-key');
  });

  it('returns failed{schema-violation} when validateProfile rejects', async () => {
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientReturning({ profile: 'wrong shape' }),
      },
    });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.reason).toBe('schema-violation');
  });

  it('returns aborted when signal is already aborted at start', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientReturning(validRawProfile),
      },
      signal: ctrl.signal,
    });
    expect(result.kind).toBe('aborted');
  });
});
