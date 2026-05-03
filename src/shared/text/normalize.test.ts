import { describe, expect, it } from 'vitest';
import { normalizeForSearch, matchesQuery } from './normalize';

describe('normalizeForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeForSearch('Vallée')).toBe('vallee');
    expect(normalizeForSearch('Übermensch')).toBe('ubermensch');
    expect(normalizeForSearch('  AlrEady  ')).toBe('  already  ');
  });
});

describe('matchesQuery', () => {
  it('substring match against any haystack', () => {
    expect(matchesQuery('vallee', ['Field Notes from Nowhere', 'P. Vallée'])).toBe(true);
    expect(matchesQuery('vallee', ['Quiet Things', 'L. Onuma'])).toBe(false);
  });
  it('empty query matches anything', () => {
    expect(matchesQuery('', ['anything'])).toBe(true);
  });
});
