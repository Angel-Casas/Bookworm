// Pure helpers for PDF text extraction. PDF text-layer items are absolutely
// positioned (not in DOM reading order), so we reconstruct paragraphs from
// y-position groupings + line-spacing gaps + indent signals. All pure;
// fully unit-testable without spinning up pdfjs.

// Mirrors the shape pdfjs-dist's getTextContent() returns.
export type PdfItem = {
  readonly str: string;
  readonly transform: readonly [number, number, number, number, number, number];
};

export type PdfLine = {
  readonly text: string;
  readonly y: number;
  readonly x: number;
};

export type PdfParagraph = {
  readonly text: string;
  readonly y: number;
};

const Y_JITTER = 2;
const PARAGRAPH_GAP_MULTIPLIER = 1.5;
const INDENT_SHIFT_FRACTION = 0.05; // 5% of page width
const ASSUMED_PAGE_WIDTH = 612; // PDF.js default; close enough for indent ratio
const MIN_PAGES_FOR_BOILERPLATE = 4;
const BOILERPLATE_PAGE_FRACTION = 0.5;

export function groupItemsIntoLines(items: readonly PdfItem[]): PdfLine[] {
  if (items.length === 0) return [];
  // Sort by y descending (PDF y-axis is bottom-up; higher y = closer to top of page).
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5]);
  const lines: { items: PdfItem[]; y: number }[] = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const last = lines[lines.length - 1];
    if (last !== undefined && Math.abs(last.y - y) <= Y_JITTER) {
      last.items.push(it);
    } else {
      lines.push({ items: [it], y });
    }
  }
  return lines.map((l) => {
    const sortedX = [...l.items].sort((a, b) => a.transform[4] - b.transform[4]);
    const text = sortedX
      .map((i) => i.str)
      .filter((s) => s.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const x = sortedX[0]?.transform[4] ?? 0;
    return { text, y: l.y, x };
  });
}

export function groupLinesIntoParagraphs(lines: readonly PdfLine[]): PdfParagraph[] {
  if (lines.length === 0) return [];
  const first = lines[0];
  if (first === undefined) return [];
  if (lines.length === 1) {
    return [{ text: first.text, y: first.y }];
  }

  // Compute median vertical line spacing (descending y → spacing is prev.y - curr.y).
  const spacings: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    if (prev === undefined || curr === undefined) continue;
    spacings.push(prev.y - curr.y);
  }
  const sortedSpacings = [...spacings].sort((a, b) => a - b);
  const medianSpacing = sortedSpacings[Math.floor(sortedSpacings.length / 2)] ?? 12;
  const indentThreshold = ASSUMED_PAGE_WIDTH * INDENT_SHIFT_FRACTION;

  const paragraphs: { lines: PdfLine[] }[] = [{ lines: [first] }];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    if (prev === undefined || curr === undefined) continue;
    const gap = prev.y - curr.y;
    const indentShift = Math.abs(curr.x - prev.x);
    const breakHere =
      gap > medianSpacing * PARAGRAPH_GAP_MULTIPLIER || indentShift > indentThreshold;
    if (breakHere) {
      paragraphs.push({ lines: [curr] });
    } else {
      const tail = paragraphs[paragraphs.length - 1];
      if (tail !== undefined) tail.lines.push(curr);
    }
  }

  return paragraphs.map((p) => {
    const head = p.lines[0];
    return {
      text: p.lines.map((l) => l.text).join(' '),
      y: head?.y ?? 0,
    };
  });
}

export function dehyphenateWordWraps(text: string): string {
  // Join `foo-\nbar` → `foobar` only when next char is lowercase (typical
  // word-wrap). Preserve hyphens that end before uppercase/punctuation
  // (Smith-\nJones, hello-\n!).
  return text.replace(/(\w+)-\n(\w*)/g, (match, before: string, after: string) => {
    if (after.length === 0 || !/^[a-z]/.test(after)) return match;
    return `${before}${after}`;
  });
}

export function detectRunningHeadersFooters(
  pageTexts: readonly (readonly string[])[],
): Set<string> {
  if (pageTexts.length < MIN_PAGES_FOR_BOILERPLATE) return new Set();
  const counts = new Map<string, number>();
  for (const page of pageTexts) {
    const seen = new Set<string>();
    for (const line of page) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  const threshold = pageTexts.length * BOILERPLATE_PAGE_FRACTION;
  const result = new Set<string>();
  for (const [line, n] of counts) {
    if (n > threshold) result.add(line);
  }
  return result;
}

const ARABIC_PAGE_NUMBER = /^\s*\d+\s*$/;
const ROMAN_PAGE_NUMBER = /^\s*[ivxlcdm]+\s*$/i;

export function isPageNumberOnly(s: string): boolean {
  if (s.length === 0) return false;
  return ARABIC_PAGE_NUMBER.test(s) || ROMAN_PAGE_NUMBER.test(s);
}
