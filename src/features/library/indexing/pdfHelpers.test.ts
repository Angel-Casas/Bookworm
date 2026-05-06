import { describe, it, expect } from 'vitest';
import {
  groupItemsIntoLines,
  groupLinesIntoParagraphs,
  dehyphenateWordWraps,
  detectRunningHeadersFooters,
  isPageNumberOnly,
  type PdfItem,
} from './pdfHelpers';

function item(str: string, x: number, y: number): PdfItem {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

describe('groupItemsIntoLines', () => {
  it('groups items at the same y-position into one line', () => {
    const items = [item('Hello', 0, 100), item('world', 50, 100)];
    const lines = groupItemsIntoLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Hello world');
    expect(lines[0]!.y).toBe(100);
  });

  it('separates items at different y-positions', () => {
    const items = [item('First', 0, 200), item('Second', 0, 100)];
    const lines = groupItemsIntoLines(items);
    expect(lines).toHaveLength(2);
  });

  it('tolerates ±2px y-jitter as same line', () => {
    const items = [item('A', 0, 100), item('B', 50, 101.5)];
    const lines = groupItemsIntoLines(items);
    expect(lines).toHaveLength(1);
  });

  it('sorts items within a line by x-coordinate', () => {
    const items = [item('world', 50, 100), item('Hello', 0, 100)];
    const lines = groupItemsIntoLines(items);
    expect(lines[0]!.text).toBe('Hello world');
  });
});

describe('groupLinesIntoParagraphs', () => {
  it('treats consecutive close-spaced lines as one paragraph', () => {
    const lines = [
      { text: 'First line', y: 100, x: 0 },
      { text: 'second line', y: 88, x: 0 },
      { text: 'third line', y: 76, x: 0 },
    ];
    const paragraphs = groupLinesIntoParagraphs(lines);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.text).toBe('First line second line third line');
  });

  it('breaks paragraphs on a vertical gap > 1.5x median line height', () => {
    const lines = [
      { text: 'A', y: 100, x: 0 },
      { text: 'B', y: 88, x: 0 },
      { text: 'C', y: 50, x: 0 }, // gap of 38 > 1.5 * 12
      { text: 'D', y: 38, x: 0 },
    ];
    const paragraphs = groupLinesIntoParagraphs(lines);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.text).toBe('A B');
    expect(paragraphs[1]!.text).toBe('C D');
  });

  it('breaks paragraphs on indent shift > 5% of page width', () => {
    // Page width assumed 612, so 5% = 30.6. Use shift of 40 to clearly cross.
    const lines = [
      { text: 'A', y: 100, x: 50 },
      { text: 'B', y: 88, x: 50 },
      { text: 'C', y: 76, x: 90 }, // indent shift of 40 > 30.6
    ];
    const paragraphs = groupLinesIntoParagraphs(lines);
    expect(paragraphs).toHaveLength(2);
  });

  it('returns one paragraph for a single line', () => {
    const paragraphs = groupLinesIntoParagraphs([{ text: 'Lonely', y: 100, x: 0 }]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.text).toBe('Lonely');
  });

  it('returns empty array for empty input', () => {
    expect(groupLinesIntoParagraphs([])).toEqual([]);
  });
});

describe('dehyphenateWordWraps', () => {
  it('joins lowercase-continuing word-wraps without the hyphen', () => {
    expect(dehyphenateWordWraps('foo-\nbar')).toBe('foobar');
  });

  it('preserves hyphens followed by uppercase or punct (sentence-end)', () => {
    expect(dehyphenateWordWraps('Smith-\nJones')).toBe('Smith-\nJones');
    expect(dehyphenateWordWraps('hello-\n!')).toBe('hello-\n!');
  });

  it('handles multiple word-wraps in one string', () => {
    expect(dehyphenateWordWraps('hap-\npy fam-\nilies')).toBe('happy families');
  });

  it('leaves regular hyphenated words alone (no newline)', () => {
    expect(dehyphenateWordWraps('well-being is great')).toBe('well-being is great');
  });
});

describe('detectRunningHeadersFooters', () => {
  it('returns line-strings that appear on > 50% of pages (4+ pages)', () => {
    const pages = [
      ['Header X', 'page 1 content'],
      ['Header X', 'page 2 content'],
      ['Header X', 'page 3 content'],
      ['Footer X', 'page 4 content'],
    ];
    const boilerplate = detectRunningHeadersFooters(pages);
    expect(boilerplate.has('Header X')).toBe(true);
  });

  it('does NOT flag a line that appears on ≤ 50% of pages', () => {
    const pages = [
      ['Header X', 'a'],
      ['Header X', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ];
    const boilerplate = detectRunningHeadersFooters(pages);
    expect(boilerplate.has('Header X')).toBe(false);
  });

  it('returns an empty set for fewer than 4 pages (insufficient sample)', () => {
    const pages = [
      ['Header X', 'a'],
      ['Header X', 'b'],
      ['Header X', 'c'],
    ];
    expect(detectRunningHeadersFooters(pages).size).toBe(0);
  });

  it('handles empty pages without throwing', () => {
    const pages = [[], [], [], []];
    expect(detectRunningHeadersFooters(pages).size).toBe(0);
  });
});

describe('isPageNumberOnly', () => {
  it('matches Arabic page numbers', () => {
    expect(isPageNumberOnly('42')).toBe(true);
    expect(isPageNumberOnly('  42  ')).toBe(true);
    expect(isPageNumberOnly('1234')).toBe(true);
  });

  it('matches roman numeral page numbers (lower or upper)', () => {
    expect(isPageNumberOnly('iv')).toBe(true);
    expect(isPageNumberOnly('XII')).toBe(true);
    expect(isPageNumberOnly('viii')).toBe(true);
  });

  it('rejects strings with text content', () => {
    expect(isPageNumberOnly('Page 42')).toBe(false);
    expect(isPageNumberOnly('42 of 100')).toBe(false);
    expect(isPageNumberOnly('Chapter 1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isPageNumberOnly('')).toBe(false);
  });
});
