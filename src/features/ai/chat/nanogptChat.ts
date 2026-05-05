import { parseSSE } from './parseSSE';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type ChatCompletionMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
};

export type ChatCompletionRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly messages: readonly ChatCompletionMessage[];
  readonly signal?: AbortSignal;
};

export type StreamEvent =
  | { readonly kind: 'delta'; readonly text: string }
  | {
      readonly kind: 'usage';
      readonly prompt: number;
      readonly completion: number;
      readonly cached?: number;
    }
  | { readonly kind: 'done' };

export type ChatCompletionFailure =
  | { readonly reason: 'invalid-key'; readonly status: 401 | 403 }
  | { readonly reason: 'rate-limit'; readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly reason: 'model-unavailable'; readonly status: 404 | 400 }
  | { readonly reason: 'server'; readonly status: number }
  | { readonly reason: 'network' }
  | { readonly reason: 'aborted' }
  | { readonly reason: 'malformed-stream' };

export class ChatCompletionError extends Error {
  readonly failure: ChatCompletionFailure;
  constructor(failure: ChatCompletionFailure) {
    super(`chat completion failed: ${failure.reason}`);
    this.name = 'ChatCompletionError';
    this.failure = failure;
  }
}

function classifyHttpFailure(res: Response): ChatCompletionFailure {
  const status = res.status;
  if (status === 401 || status === 403) {
    return { reason: 'invalid-key', status: status };
  }
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    const parsed = ra !== null ? Number.parseInt(ra, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? { reason: 'rate-limit', status: 429, retryAfterSeconds: parsed }
      : { reason: 'rate-limit', status: 429 };
  }
  if (status === 404 || status === 400) {
    return { reason: 'model-unavailable', status: status };
  }
  return { reason: 'server', status };
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function isCompletionError(e: unknown): e is ChatCompletionError {
  return e instanceof ChatCompletionError;
}

type RawChunkPayload = {
  choices?: { delta?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_tokens?: number;
  };
};

export async function* streamChatCompletion(
  req: ChatCompletionRequest,
): AsyncGenerator<StreamEvent> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.modelId,
        messages: req.messages,
        stream: true,
      }),
      ...(req.signal !== undefined && { signal: req.signal }),
    });
  } catch (e) {
    if (isAbortError(e)) {
      throw new ChatCompletionError({ reason: 'aborted' });
    }
    throw new ChatCompletionError({ reason: 'network' });
  }

  if (!res.ok || !res.body) {
    throw new ChatCompletionError(classifyHttpFailure(res));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const result = parseSSE(chunk, buffered);
      buffered = result.remainder;
      for (const evt of result.events) {
        if (evt.kind === 'done') {
          yield { kind: 'done' };
          return;
        }
        let payload: RawChunkPayload;
        try {
          payload = JSON.parse(evt.data) as RawChunkPayload;
        } catch {
          throw new ChatCompletionError({ reason: 'malformed-stream' });
        }
        const delta = payload.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield { kind: 'delta', text: delta };
        }
        if (payload.usage) {
          yield {
            kind: 'usage',
            prompt: payload.usage.prompt_tokens ?? 0,
            completion: payload.usage.completion_tokens ?? 0,
            ...(payload.usage.cached_tokens !== undefined
              ? { cached: payload.usage.cached_tokens }
              : {}),
          };
        }
      }
    }
  } catch (e) {
    if (isAbortError(e)) {
      throw new ChatCompletionError({ reason: 'aborted' });
    }
    if (isCompletionError(e)) throw e;
    throw new ChatCompletionError({ reason: 'malformed-stream' });
  } finally {
    reader.releaseLock();
  }
}
