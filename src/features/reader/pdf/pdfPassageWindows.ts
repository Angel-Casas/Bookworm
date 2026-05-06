// Pure helpers for Phase 4.4 PDF passage-mode window extraction. Separated
// from PdfReaderAdapter so the indexing/slicing logic can be unit-tested
// without spinning up pdfjs.

const SELECTION_CHAR_CAP = 4000;
// Search prefix length for first-match-wins indexing. We don't search for
// the full selection (which can be up to 4000 chars) because indexOf on long
// strings amplifies whitespace-mismatch failures; the prefix is long enough
// to be unique on a typical page but short enough to be robust.
const SEARCH_PREFIX_LENGTH = 200;

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();

function trimAtWordBoundaryStart(s: string): string | undefined {
  if (s.length === 0) return undefined;
  const firstSpace = s.indexOf(' ');
  const trimmed = firstSpace > 0 ? s.slice(firstSpace + 1) : s;
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimAtWordBoundaryEnd(s: string): string | undefined {
  if (s.length === 0) return undefined;
  const lastSpace = s.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? s.slice(0, lastSpace) : s;
  return trimmed.length > 0 ? trimmed : undefined;
}

// Documented limitation — first-match wins: when `selectedText` appears more
// than once in `pageText`, the first occurrence's windows are returned. The
// anchor passed to the workspace is unaffected (rects come from the user's
// actual selection), so jump-to-passage is correct regardless. The model just
// sees windowBefore/windowAfter from a different instance, which can subtly
// mislead its reading of context. TODO(passage-y-bias): bias the search by
// the selection's mean rect-y when feasible (requires keeping a parallel
// item→char-offset map so the adapter can map y-coordinates to indices).
export function extractPassageWindows(
  pageText: string,
  selectedText: string,
  windowChars: number,
): {
  text: string;
  windowBefore?: string;
  windowAfter?: string;
} {
  const cleanSelected = normalizeWhitespace(selectedText);
  if (cleanSelected.length === 0) return { text: '' };
  const cappedText =
    cleanSelected.length > SELECTION_CHAR_CAP
      ? cleanSelected.slice(0, SELECTION_CHAR_CAP)
      : cleanSelected;

  if (pageText.length === 0) return { text: cappedText };

  const searchKey =
    cappedText.length > SEARCH_PREFIX_LENGTH
      ? cappedText.slice(0, SEARCH_PREFIX_LENGTH)
      : cappedText;
  const matchIdx = pageText.indexOf(searchKey);
  if (matchIdx < 0) return { text: cappedText };

  const beforeStart = Math.max(0, matchIdx - windowChars);
  const beforeRaw = pageText.slice(beforeStart, matchIdx);
  const afterStart = matchIdx + cappedText.length;
  const afterRaw = pageText.slice(afterStart, afterStart + windowChars);

  const windowBefore = trimAtWordBoundaryStart(beforeRaw);
  const windowAfter = trimAtWordBoundaryEnd(afterRaw);

  const result: {
    text: string;
    windowBefore?: string;
    windowAfter?: string;
  } = { text: cappedText };
  if (windowBefore !== undefined) result.windowBefore = windowBefore;
  if (windowAfter !== undefined) result.windowAfter = windowAfter;
  return result;
}
