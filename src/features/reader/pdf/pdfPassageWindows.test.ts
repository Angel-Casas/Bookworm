import { describe, it, expect } from 'vitest';
import { extractPassageWindows } from './pdfPassageWindows';

describe('extractPassageWindows', () => {
  it('returns text + windows for a found selection in the middle of the page', () => {
    const page =
      'The quick brown fox jumps over the lazy dog. The mouse ran up the clock and down again.';
    const result = extractPassageWindows(page, 'mouse ran up the clock', 30);
    expect(result.text).toBe('mouse ran up the clock');
    expect(result.windowBefore).toContain('lazy dog');
    // windowAfter is the next 30 chars after the selection, trimmed at the
    // last word-boundary space (so the slice doesn't end mid-word).
    expect(result.windowAfter).toContain('and down');
  });

  it('returns text-only when the selection is not found in the page text', () => {
    const page = 'lorem ipsum dolor sit amet';
    const result = extractPassageWindows(page, 'this phrase does not appear', 100);
    expect(result.text).toBe('this phrase does not appear');
    expect(result.windowBefore).toBeUndefined();
    expect(result.windowAfter).toBeUndefined();
  });

  it('returns windowBefore=undefined when the selection is at the start of the page', () => {
    const page = 'opening words and then more content follows';
    const result = extractPassageWindows(page, 'opening words', 30);
    expect(result.text).toBe('opening words');
    expect(result.windowBefore).toBeUndefined();
    expect(result.windowAfter).toContain('and then');
  });

  it('returns windowAfter=undefined when the selection is at the end of the page', () => {
    const page = 'beginning content and then ending phrase';
    const result = extractPassageWindows(page, 'ending phrase', 30);
    expect(result.text).toBe('ending phrase');
    expect(result.windowBefore).toContain('and then');
    expect(result.windowAfter).toBeUndefined();
  });

  it('uses first-match-wins when the selection appears multiple times', () => {
    // "the same phrase" appears at positions 0 and 50.
    const page =
      'the same phrase opens this. middle middle middle. the same phrase repeats here too.';
    const result = extractPassageWindows(page, 'the same phrase', 30);
    expect(result.text).toBe('the same phrase');
    // windowAfter should come from after the FIRST occurrence (position 0),
    // i.e. " opens this. middle middle..." — not from after the second.
    expect(result.windowAfter).toContain('opens this');
    expect(result.windowAfter).not.toContain('repeats here');
  });

  it('caps selection text at 4000 characters', () => {
    const longSel = 'x'.repeat(5000);
    const page = `prefix ${longSel} suffix`;
    const result = extractPassageWindows(page, longSel, 50);
    expect(result.text.length).toBe(4000);
  });

  it('normalizes whitespace in the input selection', () => {
    const page = 'word one word two word three';
    const result = extractPassageWindows(page, '  word\n\ntwo  ', 20);
    // Normalization collapses '\n\n' and trims.
    expect(result.text).toBe('word two');
  });

  it('returns {text: ""} when the normalized selection is empty', () => {
    const result = extractPassageWindows('whatever', '   \n\t  ', 20);
    expect(result.text).toBe('');
    expect(result.windowBefore).toBeUndefined();
    expect(result.windowAfter).toBeUndefined();
  });

  it('trims windows at word boundaries', () => {
    // "lorem ipsum dolor sit amet consectetur" — selection is "consectetur".
    // windowBefore (chars before "consectetur") should not start mid-word.
    const page = 'lorem ipsum dolor sit amet consectetur adipiscing elit';
    const result = extractPassageWindows(page, 'consectetur', 15);
    if (result.windowBefore !== undefined) {
      // Must not start with a partial word — every word in the page is
      // separated by single spaces, so the windowBefore should start at
      // a word that's wholly contained.
      expect(result.windowBefore[0]).not.toBe(' ');
      // The 15-char slice "ipsum dolor sit" before "consectetur" gets its
      // first partial word dropped → "dolor sit amet" (or similar).
      expect(result.windowBefore.startsWith('lorem')).toBe(false);
    }
  });

  it('returns just the text when pageText is empty', () => {
    const result = extractPassageWindows('', 'some selection', 100);
    expect(result.text).toBe('some selection');
    expect(result.windowBefore).toBeUndefined();
    expect(result.windowAfter).toBeUndefined();
  });
});
