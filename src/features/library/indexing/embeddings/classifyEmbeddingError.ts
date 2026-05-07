// Embedding-stage error reasons surfaced as Book.indexingStatus.failed.reason.
// Specific reasons drive specific library-card UX (e.g., "Open Settings"
// affordance for missing/locked API keys). All non-recognized errors fall
// through to the generic 'embedding-failed'.
export type EmbeddingFailureReason =
  | 'embedding-no-key'
  | 'embedding-insufficient-balance'
  | 'embedding-rate-limited'
  | 'embedding-failed';

function readEmbedFailureReason(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const failure = (err as Record<string, unknown>).failure;
  if (typeof failure !== 'object' || failure === null) return null;
  const reason = (failure as Record<string, unknown>).reason;
  return typeof reason === 'string' ? reason : null;
}

export function classifyEmbeddingError(err: unknown): EmbeddingFailureReason {
  const reason = readEmbedFailureReason(err);
  if (reason === 'rate-limit') return 'embedding-rate-limited';
  // 'invalid-key' covers both server-side 401/403 and our local empty-key
  // short-circuit (status 0 from nanogptEmbeddings.embed). Both surface as
  // the same actionable card state: "API key required → Open Settings".
  if (reason === 'invalid-key') return 'embedding-no-key';
  if (reason === 'insufficient-balance') return 'embedding-insufficient-balance';
  return 'embedding-failed';
}
