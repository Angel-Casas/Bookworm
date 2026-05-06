const PURE_PUNCT_RE = /^[^\p{L}\p{N}]+$/u;
const TRIM_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

export function tokenizeForBM25(text: string): readonly string[] {
  const folded = text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS_RE, '');
  return folded
    .split(/\s+/)
    .map((t) => t.replace(TRIM_PUNCT_RE, ''))
    .filter((t) => t.length > 0 && !PURE_PUNCT_RE.test(t));
}
