import { describe, expect, it } from 'vitest';
import { tokenizeForBM25 } from './tokenize';

describe('tokenizeForBM25', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenizeForBM25('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips diacritics', () => {
    expect(tokenizeForBM25('café résumé')).toEqual(['cafe', 'resume']);
  });

  it('drops pure-punctuation tokens', () => {
    expect(tokenizeForBM25('hello, world!')).toEqual(['hello', 'world']);
  });

  it('returns empty for empty / whitespace-only input', () => {
    expect(tokenizeForBM25('')).toEqual([]);
    expect(tokenizeForBM25('   ')).toEqual([]);
  });

  it('preserves Unicode letters', () => {
    expect(tokenizeForBM25('hello 你好 world')).toEqual(['hello', '你好', 'world']);
  });
});
