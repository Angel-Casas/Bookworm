// Pure helpers for chunk text normalization and token estimation.
// No I/O; fully unit-testable without a DOM or IDB.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const WHITESPACE_RUN = /\s+/g;

export function normalizeChunkText(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').replace(WHITESPACE_RUN, ' ').trim();
}

// Char/4 heuristic — the classic OpenAI rule of thumb. Free, deterministic,
// good enough for chunk-packing where the budget is fuzzy. Phase 5.2 retrieval
// can self-calibrate against actual model usage.
export function tokenEstimate(s: string): number {
  return Math.ceil(s.length / 4);
}
