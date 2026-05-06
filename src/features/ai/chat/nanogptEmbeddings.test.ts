import { afterEach, describe, expect, it } from 'vitest';
import { embed, EmbedError } from './nanogptEmbeddings';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

function makeOkResponse(vectors: number[][], promptTokens = 7): Response {
  return new Response(
    JSON.stringify({
      data: vectors.map((v, i) => ({ embedding: v, index: i })),
      usage: { prompt_tokens: promptTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('nanogptEmbeddings.embed', () => {
  it('happy path returns vectors in input order', async () => {
    const dim = 1536;
    const v0 = new Array<number>(dim).fill(0).map((_, i) => i / dim);
    const v1 = new Array<number>(dim).fill(0).map((_, i) => (i + 1) / dim);
    mockFetch((input, init) => {
      expect(typeof input).toBe('string');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer KEY');
      const body = JSON.parse(init?.body as string) as { model: string; input: string[] };
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toEqual(['a', 'b']);
      return Promise.resolve(makeOkResponse([v0, v1]));
    });
    const result = await embed({
      apiKey: 'KEY',
      modelId: 'text-embedding-3-small',
      inputs: ['a', 'b'],
    });
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(result.vectors[0]?.length).toBe(dim);
    expect(result.vectors[0]?.[0] ?? 0).toBeCloseTo(0, 5);
    expect(result.vectors[1]?.[1] ?? 0).toBeCloseTo(2 / dim, 5);
    expect(result.usage?.prompt).toBe(7);
  });

  it('reorders by index when API returns out-of-order', async () => {
    const dim = 1536;
    const v0 = new Array<number>(dim).fill(0.1);
    const v1 = new Array<number>(dim).fill(0.2);
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { embedding: v1, index: 1 },
              { embedding: v0, index: 0 },
            ],
            usage: { prompt_tokens: 4 },
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await embed({
      apiKey: 'KEY',
      modelId: 'text-embedding-3-small',
      inputs: ['a', 'b'],
    });
    expect(result.vectors[0]?.[0] ?? 0).toBeCloseTo(0.1, 5);
    expect(result.vectors[1]?.[0] ?? 0).toBeCloseTo(0.2, 5);
  });

  it('throws invalid-key on 401', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 401 })));
    await expect(
      embed({ apiKey: 'BAD', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'invalid-key', status: 401 } });
  });

  it('throws rate-limit with retryAfterSeconds on 429', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '3' } })),
    );
    try {
      await embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbedError);
      expect((e as EmbedError).failure).toEqual({
        reason: 'rate-limit',
        status: 429,
        retryAfterSeconds: 3,
      });
    }
  });

  it('throws model-unavailable on 404', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'nope', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'model-unavailable', status: 404 } });
  });

  it('throws server on 500', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'server', status: 500 } });
  });

  it('throws network on fetch rejection', async () => {
    mockFetch(() => Promise.reject(new TypeError('network down')));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'network' } });
  });

  it('throws aborted when AbortError fires', async () => {
    mockFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'aborted' } });
  });

  it('throws malformed-response on non-JSON body', async () => {
    mockFetch(() => Promise.resolve(new Response('not json', { status: 200 })));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });

  it('throws dimensions-mismatch when vector length != 1536', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 2, 3], index: 0 }],
            usage: { prompt_tokens: 1 },
          }),
          { status: 200 },
        ),
      ),
    );
    try {
      await embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbedError);
      expect((e as EmbedError).failure).toEqual({
        reason: 'dimensions-mismatch',
        expected: 1536,
        got: 3,
      });
    }
  });
});
