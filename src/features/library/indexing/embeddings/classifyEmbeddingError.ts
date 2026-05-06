function isRateLimitErrorShape(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { failure?: { reason?: unknown } };
  return e.failure?.reason === 'rate-limit';
}

export function classifyEmbeddingError(
  err: unknown,
): 'embedding-failed' | 'embedding-rate-limited' {
  if (isRateLimitErrorShape(err)) return 'embedding-rate-limited';
  return 'embedding-failed';
}
