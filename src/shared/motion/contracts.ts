const LITERAL_MS_RE = /(?<![A-Za-z0-9_-])([0-9]+(?:\.[0-9]+)?)\s*ms\b/;
const LITERAL_S_RE = /(?<![A-Za-z0-9_-])([0-9]+(?:\.[0-9]+)?)\s*s\b/;
const CUBIC_BEZIER_RE = /cubic-bezier\s*\(/;
const BARE_EASE_RE = /\b(ease|ease-in|ease-out|ease-in-out)\b/;

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripVarReferences(src: string): string {
  return src.replace(/var\s*\(\s*[^)]*\)/g, 'VAR_REF');
}

export function assertNoLiteralMotion(cssSource: string): void {
  const cleaned = stripVarReferences(stripCssComments(cssSource));

  const ms = LITERAL_MS_RE.exec(cleaned);
  if (ms) {
    throw new Error(
      `motion contract: literal duration "${ms[0]}" found — use a --duration-* token`,
    );
  }

  const sMatch = LITERAL_S_RE.exec(cleaned);
  if (sMatch && sMatch[1] !== '0') {
    throw new Error(
      `motion contract: literal duration "${sMatch[0]}" found — use a --duration-* token`,
    );
  }

  if (CUBIC_BEZIER_RE.test(cleaned)) {
    throw new Error(
      'motion contract: literal cubic-bezier(...) found — use a --ease-* token',
    );
  }

  if (BARE_EASE_RE.test(cleaned)) {
    throw new Error(
      'motion contract: bare easing keyword (ease/ease-in/ease-out/ease-in-out) found — use a --ease-* token',
    );
  }
}

// Match `@media (prefers-reduced-motion: reduce) { ... }`, allowing one level
// of nested braces (the `:root { ... }` block inside).
const REDUCED_BLOCK_RE =
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/;
const REQUIRED_DURATIONS = [
  '--duration-fast',
  '--duration-base',
  '--duration-slow',
  '--duration-slower',
] as const;

const LOCAL_REDUCED_BLOCK_RE =
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/;

export function assertNoLocalReducedMotionBlock(cssSource: string): void {
  if (LOCAL_REDUCED_BLOCK_RE.test(cssSource)) {
    throw new Error(
      'motion contract: local @media (prefers-reduced-motion: reduce) block found — the global token override in tokens.css is the single source of truth; remove this local block',
    );
  }
}

export function assertReducedMotionZeroesTokens(tokensSource: string): void {
  const block = REDUCED_BLOCK_RE.exec(tokensSource);
  const inner = block?.[1];
  if (!inner) {
    throw new Error(
      'motion contract: no `@media (prefers-reduced-motion: reduce)` block found in tokens source',
    );
  }
  for (const tok of REQUIRED_DURATIONS) {
    const re = new RegExp(`${tok}\\s*:\\s*([^;]+);`);
    const value = re.exec(inner)?.[1]?.trim();
    if (value === undefined) {
      throw new Error(
        `motion contract: ${tok} is not set inside the reduced-motion block`,
      );
    }
    if (value !== '0ms') {
      throw new Error(
        `motion contract: ${tok} inside reduced-motion block is "${value}", expected "0ms"`,
      );
    }
  }
}
