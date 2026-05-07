import { afterEach, describe, expect, it } from 'vitest';
import { complete, StructuredError } from './nanogptStructured';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

const PROBE_SCHEMA = {
  name: 'probe',
  strict: true as const,
  schema: {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  },
};

function makeOkResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('nanogptStructured.complete', () => {
  it('happy path JSON-parses choices[0].message.content into T', async () => {
    mockFetch((_input, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer KEY');
      const body = JSON.parse(init?.body as string) as {
        model: string;
        messages: { role: string; content: string }[];
        response_format: { type: string; json_schema: { name: string } };
      };
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.name).toBe('probe');
      return Promise.resolve(makeOkResponse('{"ok":true}'));
    });
    const result = await complete<{ ok: boolean }>({
      apiKey: 'KEY',
      modelId: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Return ok=true' }],
      schema: PROBE_SCHEMA,
    });
    expect(result.value).toEqual({ ok: true });
    expect(result.usage?.prompt).toBe(10);
    expect(result.usage?.completion).toBe(5);
  });

  it('throws invalid-key on 401', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 401 })));
    await expect(
      complete({
        apiKey: 'BAD',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'invalid-key', status: 401 } });
  });

  it('throws rate-limit with retryAfterSeconds on 429', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '5' } })),
    );
    try {
      await complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError);
      expect((e as StructuredError).failure).toEqual({
        reason: 'rate-limit',
        status: 429,
        retryAfterSeconds: 5,
      });
    }
  });

  it('throws model-unavailable on 404', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'nope',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'model-unavailable', status: 404 } });
  });

  it('throws server on 500', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'server', status: 500 } });
  });

  it('throws network on fetch rejection', async () => {
    mockFetch(() => Promise.reject(new TypeError('network down')));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'network' } });
  });

  it('throws aborted when AbortError fires', async () => {
    mockFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'aborted' } });
  });

  it('throws malformed-response on non-JSON body', async () => {
    mockFetch(() => Promise.resolve(new Response('not json', { status: 200 })));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });

  it('throws malformed-response when message.content is empty', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
        }),
      ),
    );
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });

  it('throws malformed-response when content is not valid JSON', async () => {
    mockFetch(() => Promise.resolve(makeOkResponse('this is not json')));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });
});
