import type { ChatCompletionMessage } from './nanogptChat';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type StructuredJsonSchema = {
  readonly name: string;
  readonly strict: true;
  readonly schema: object;
};

export type StructuredRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly messages: readonly ChatCompletionMessage[];
  readonly schema: StructuredJsonSchema;
  readonly signal?: AbortSignal;
};

export type StructuredResult<T> = {
  readonly value: T;
  readonly usage?: { readonly prompt: number; readonly completion: number };
};

export type StructuredFailure =
  | { readonly reason: 'invalid-key'; readonly status: 401 | 403 }
  | { readonly reason: 'rate-limit'; readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly reason: 'model-unavailable'; readonly status: 404 | 400 }
  | { readonly reason: 'server'; readonly status: number }
  | { readonly reason: 'network' }
  | { readonly reason: 'aborted' }
  | { readonly reason: 'malformed-response' }
  | { readonly reason: 'schema-violation'; readonly issue: string };

export class StructuredError extends Error {
  readonly failure: StructuredFailure;
  constructor(failure: StructuredFailure) {
    super(`structured request failed: ${failure.reason}`);
    this.name = 'StructuredError';
    this.failure = failure;
  }
}

// Client surface used by callers; apiKey is bound at construction time so
// downstream code (orchestrators, hooks) doesn't have to thread the key.
export type StructuredClient = {
  complete<T>(req: Omit<StructuredRequest, 'apiKey'>): Promise<StructuredResult<T>>;
};

function classifyHttpFailure(res: Response): StructuredFailure {
  const status = res.status;
  if (status === 401 || status === 403) return { reason: 'invalid-key', status };
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    const parsed = ra !== null ? Number.parseInt(ra, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? { reason: 'rate-limit', status: 429, retryAfterSeconds: parsed }
      : { reason: 'rate-limit', status: 429 };
  }
  if (status === 404 || status === 400) return { reason: 'model-unavailable', status };
  return { reason: 'server', status };
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

type RawChatResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function complete<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
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
        response_format: { type: 'json_schema', json_schema: req.schema },
      }),
      ...(req.signal !== undefined && { signal: req.signal }),
    });
  } catch (e) {
    if (isAbortError(e)) throw new StructuredError({ reason: 'aborted' });
    throw new StructuredError({ reason: 'network' });
  }

  if (!res.ok) throw new StructuredError(classifyHttpFailure(res));

  let payload: RawChatResponse;
  try {
    payload = (await res.json()) as RawChatResponse;
  } catch {
    throw new StructuredError({ reason: 'malformed-response' });
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') {
    throw new StructuredError({ reason: 'malformed-response' });
  }

  let value: T;
  try {
    value = JSON.parse(content) as T;
  } catch {
    throw new StructuredError({ reason: 'malformed-response' });
  }

  const result: StructuredResult<T> =
    typeof payload.usage?.prompt_tokens === 'number' &&
    typeof payload.usage.completion_tokens === 'number'
      ? {
          value,
          usage: {
            prompt: payload.usage.prompt_tokens,
            completion: payload.usage.completion_tokens,
          },
        }
      : { value };
  return result;
}
