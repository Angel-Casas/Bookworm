const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type ValidateKeyResult =
  | { readonly ok: true; readonly models: readonly { id: string }[] }
  | {
      readonly ok: false;
      readonly reason: 'invalid-key' | 'network' | 'other';
      readonly status?: number;
    };

export type ModelsFetchResult = ValidateKeyResult;

type ModelsResponseBody = { readonly data?: readonly unknown[] };

async function getModels(apiKey: string, signal?: AbortSignal): Promise<ValidateKeyResult> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(signal !== undefined && { signal }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'invalid-key', status: res.status };
  }
  if (!res.ok) {
    return { ok: false, reason: 'other', status: res.status };
  }
  let body: ModelsResponseBody;
  try {
    body = (await res.json()) as ModelsResponseBody;
  } catch {
    return { ok: false, reason: 'other' };
  }
  const models = (body.data ?? [])
    .filter(
      (m): m is { id: string } =>
        typeof m === 'object' && m !== null && 'id' in m && typeof m.id === 'string',
    )
    .map((m) => ({ id: m.id }));
  return { ok: true, models };
}

export async function validateKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ValidateKeyResult> {
  return getModels(apiKey, signal);
}

export async function fetchCatalog(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelsFetchResult> {
  return getModels(apiKey, signal);
}
