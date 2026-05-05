import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamChatCompletion, type ChatCompletionRequest } from './nanogptChat';

function makeStreamResponse(body: string, status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function makeJsonErrorResponse(status: number, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter);
  return new Response('{"error":"x"}', { status, headers });
}

const baseReq: ChatCompletionRequest = {
  apiKey: 'sk-fake',
  modelId: 'gpt-x',
  messages: [{ role: 'user', content: 'hi' }],
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('streamChatCompletion', () => {
  it('emits delta events from data chunks', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse(
          'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
            'data: [DONE]\n\n',
        ),
      );
    const events: unknown[] = [];
    for await (const e of streamChatCompletion(baseReq)) events.push(e);
    expect(events).toEqual([
      { kind: 'delta', text: 'hel' },
      { kind: 'delta', text: 'lo' },
      { kind: 'done' },
    ]);
  });

  it('emits usage event from final chunk when present', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse(
          'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
            'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n' +
            'data: [DONE]\n\n',
        ),
      );
    const events: unknown[] = [];
    for await (const e of streamChatCompletion(baseReq)) events.push(e);
    expect(events).toContainEqual({ kind: 'usage', prompt: 10, completion: 3 });
  });

  it('throws invalid-key on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(401));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'invalid-key', status: 401 } });
  });

  it('throws rate-limit with retryAfter on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(429, '12'));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'rate-limit', status: 429, retryAfterSeconds: 12 } });
  });

  it('throws model-unavailable on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(404));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'model-unavailable', status: 404 } });
  });

  it('throws server on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(500));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'server', status: 500 } });
  });

  it('throws network on fetch rejection', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('network down'));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'network' } });
  });

  it('throws aborted when fetch rejects with AbortError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'aborted' } });
  });

  it('throws malformed-stream when the stream contains invalid JSON', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeStreamResponse('data: not-json\n\n'));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) {
        void _;
      }
    }).rejects.toMatchObject({ failure: { reason: 'malformed-stream' } });
  });
});
