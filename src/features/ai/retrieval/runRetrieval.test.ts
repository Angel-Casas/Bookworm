import { describe, expect, it } from 'vitest';
import { runRetrieval } from './runRetrieval';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  SectionId,
  type BookEmbedding,
  type TextChunk,
} from '@/domain';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type { EmbedClient } from '@/features/library/indexing/embeddings/types';

function mkChunk(idx: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text: `chunk ${String(idx)} text about cats`,
    normalizedText: `chunk ${String(idx)} text about cats`,
    tokenEstimate: 20,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

function mkEmbedding(idx: number): BookEmbedding {
  const v = new Float32Array(1536);
  for (let i = 0; i < 1536; i += 1) v[i] = idx === 0 ? 1 / Math.sqrt(1536) : (i + idx) / 1536;
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    vector: v,
    chunkerVersion: 1,
    embeddingModelVersion: 1,
    embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

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

function embeddingsRepoFromList(
  embeddings: readonly BookEmbedding[],
): BookEmbeddingsRepository {
  return {
    upsertMany: () => Promise.resolve(),
    listByBook: () => Promise.resolve(embeddings),
    deleteByBook: () => Promise.resolve(),
    countByBook: () => Promise.resolve(embeddings.length),
    hasEmbeddingFor: () => Promise.resolve(true),
    countStaleVersions: () => Promise.resolve([]),
    deleteOrphans: () => Promise.resolve(0),
  };
}

describe('runRetrieval', () => {
  it('happy path returns ok bundle', async () => {
    const chunks = [mkChunk(0), mkChunk(1), mkChunk(2)];
    const embeddings = chunks.map((_, i) => mkEmbedding(i));
    const embedClient: EmbedClient = {
      embed: () => {
        const v = new Float32Array(1536);
        v[0] = 1;
        return Promise.resolve({ vectors: [v], usage: { prompt: 1 } });
      },
    };
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'what about cats',
      deps: {
        chunksRepo: chunksRepoFromList(chunks),
        embeddingsRepo: embeddingsRepoFromList(embeddings),
        embedClient,
      },
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.bundle.includedChunkIds.length).toBeGreaterThan(0);
  });

  it('returns no-embeddings when embeddings list is empty', async () => {
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'cats',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        embeddingsRepo: embeddingsRepoFromList([]),
        embedClient: {
          embed: () => Promise.resolve({ vectors: [new Float32Array(1536)] }),
        },
      },
    });
    expect(result.kind).toBe('no-embeddings');
  });

  it('returns embed-failed when embedClient throws EmbedError-shaped error', async () => {
    const chunks = [mkChunk(0)];
    const embeddings = [mkEmbedding(0)];
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'cats',
      deps: {
        chunksRepo: chunksRepoFromList(chunks),
        embeddingsRepo: embeddingsRepoFromList(embeddings),
        embedClient: {
          embed: () =>
            Promise.reject(
              Object.assign(new Error('embed: invalid-key'), {
                failure: { reason: 'invalid-key', status: 401 },
              }),
            ),
        },
      },
    });
    expect(result.kind).toBe('embed-failed');
    if (result.kind === 'embed-failed') {
      expect(result.reason).toBe('invalid-key');
    }
  });
});
