export type FailReason =
  | 'extract-failed'
  | 'no-text-found'
  | 'persist-failed'
  | 'unknown';

const NO_TEXT_PATTERNS = [/no text/i, /empty document/i, /no extractable/i];
const EXTRACT_PATTERNS = [
  /invalid (epub|pdf)/i,
  /failed to parse/i,
  /passwordexception/i,
  /encrypted/i,
  /malformed/i,
  /pdf parse/i,
  /epub parse/i,
];
const PERSIST_PATTERNS = [
  /quotaexceeded/i,
  /transaction aborted/i,
  /idb/i,
  /storage/i,
];

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

export function classifyError(err: unknown): FailReason {
  const msg = messageOf(err);
  if (msg.length === 0) return 'unknown';
  if (NO_TEXT_PATTERNS.some((p) => p.test(msg))) return 'no-text-found';
  if (EXTRACT_PATTERNS.some((p) => p.test(msg))) return 'extract-failed';
  if (PERSIST_PATTERNS.some((p) => p.test(msg))) return 'persist-failed';
  return 'unknown';
}
