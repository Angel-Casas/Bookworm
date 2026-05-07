import { EMBEDDING_DIMS } from '@/features/library/indexing/embeddings/EMBEDDING_MODEL';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type EmbedRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly inputs: readonly string[];
  readonly signal?: AbortSignal;
};

export type EmbedResult = {
  readonly vectors: readonly Float32Array[];
  readonly usage?: { readonly prompt: number };
};

export type EmbedFailure =
  | { readonly reason: 'invalid-key'; readonly status: 401 | 403 }
  | { readonly reason: 'rate-limit'; readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly reason: 'model-unavailable'; readonly status: 404 | 400 }
  | { readonly reason: 'server'; readonly status: number }
  | { readonly reason: 'network' }
  | { readonly reason: 'aborted' }
  | { readonly reason: 'malformed-response' }
  | { readonly reason: 'dimensions-mismatch'; readonly expected: number; readonly got: number };

export class EmbedError extends Error {
  readonly failure: EmbedFailure;
  // Server-supplied error body, captured for HTTP failures to aid debugging.
  // Most NanoGPT errors include a JSON `error.message` describing the
  // specific cause (e.g., model-not-found, batch-too-large, malformed
  // input). Without this, callers see only our coarse failure.reason.
  readonly serverMessage?: string;
  constructor(failure: EmbedFailure, serverMessage?: string) {
    const tail =
      serverMessage !== undefined && serverMessage.length > 0
        ? ` — ${serverMessage}`
        : '';
    super(`embed failed: ${failure.reason}${tail}`);
    this.name = 'EmbedError';
    this.failure = failure;
    if (serverMessage !== undefined) this.serverMessage = serverMessage;
  }
}

function classifyHttpFailure(res: Response): EmbedFailure {
  const status = res.status;
  if (status === 401 || status === 403) return { reason: 'invalid-key', status };
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    const parsed = ra !== null ? Number.parseInt(ra, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? { reason: 'rate-limit', status: 429, retryAfterSeconds: parsed }
      : { reason: 'rate-limit', status: 429 };
  }
  if (status === 404 || status === 400) {
    return { reason: 'model-unavailable', status };
  }
  return { reason: 'server', status };
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

type RawResponse = {
  data?: { embedding?: number[]; index?: number }[];
  usage?: { prompt_tokens?: number };
};

export async function embed(req: EmbedRequest): Promise<EmbedResult> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: req.modelId, input: req.inputs }),
      ...(req.signal !== undefined && { signal: req.signal }),
    });
  } catch (e) {
    if (isAbortError(e)) throw new EmbedError({ reason: 'aborted' });
    throw new EmbedError({ reason: 'network' });
  }

  if (!res.ok) {
    // Read the server's error body before throwing — NanoGPT typically
    // returns { error: { message, type, code } } with the specific cause.
    // Truncate to keep error messages bounded; full body still available
    // via err.serverMessage for callers that want it.
    const bodyText = await res.text().catch(() => '');
    const trimmed = bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
    throw new EmbedError(classifyHttpFailure(res), trimmed);
  }

  let payload: RawResponse;
  try {
    payload = (await res.json()) as RawResponse;
  } catch {
    throw new EmbedError({ reason: 'malformed-response' });
  }
  if (!Array.isArray(payload.data) || payload.data.length !== req.inputs.length) {
    throw new EmbedError({ reason: 'malformed-response' });
  }

  const ordered: (Float32Array | null)[] = new Array<Float32Array | null>(req.inputs.length).fill(
    null,
  );
  for (const item of payload.data) {
    if (!Array.isArray(item.embedding) || typeof item.index !== 'number') {
      throw new EmbedError({ reason: 'malformed-response' });
    }
    if (item.embedding.length !== EMBEDDING_DIMS) {
      throw new EmbedError({
        reason: 'dimensions-mismatch',
        expected: EMBEDDING_DIMS,
        got: item.embedding.length,
      });
    }
    if (item.index < 0 || item.index >= ordered.length) {
      throw new EmbedError({ reason: 'malformed-response' });
    }
    ordered[item.index] = Float32Array.from(item.embedding);
  }
  if (ordered.some((v) => v === null)) {
    throw new EmbedError({ reason: 'malformed-response' });
  }

  const vectors = ordered as Float32Array[];
  const result: EmbedResult =
    typeof payload.usage?.prompt_tokens === 'number'
      ? { vectors, usage: { prompt: payload.usage.prompt_tokens } }
      : { vectors };
  return result;
}
