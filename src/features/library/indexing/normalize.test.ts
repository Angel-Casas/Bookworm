import { describe, it, expect } from 'vitest';
import { normalizeChunkText, tokenEstimate } from './normalize';

describe('normalizeChunkText', () => {
  it('collapses runs of whitespace to a single space', () => {
    expect(normalizeChunkText('hello   world\n\nfoo')).toBe('hello world foo');
  });

  it('strips leading and trailing whitespace', () => {
    expect(normalizeChunkText('  hello  ')).toBe('hello');
  });

  it('strips ASCII control characters', () => {
    expect(normalizeChunkText('helloworld')).toBe('helloworld');
  });

  it('preserves non-control non-whitespace characters', () => {
    expect(normalizeChunkText('café — naïve')).toBe('café — naïve');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeChunkText('  \n\t  ')).toBe('');
  });
});

describe('tokenEstimate', () => {
  it('returns Math.ceil(length / 4)', () => {
    expect(tokenEstimate('')).toBe(0);
    expect(tokenEstimate('a')).toBe(1);
    expect(tokenEstimate('abcd')).toBe(1);
    expect(tokenEstimate('abcde')).toBe(2);
    expect(tokenEstimate('a'.repeat(400))).toBe(100);
  });
});
