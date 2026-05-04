import { describe, it, expect } from 'vitest';
import { messageForCatalogError } from './messages';

describe('messageForCatalogError', () => {
  const now = 1_700_000_000_000;
  const fiveMinAgo = now - 5 * 60_000;

  it('invalid-key, no cache → "rejected the key"', () => {
    expect(messageForCatalogError('invalid-key', { hasCache: false, now })).toMatch(
      /rejected the key/i,
    );
  });

  it('invalid-key, with cache → mentions last-known list', () => {
    expect(
      messageForCatalogError('invalid-key', { hasCache: true, fetchedAt: fiveMinAgo, now }),
    ).toMatch(/last-known list/i);
  });

  it("network, no cache → 'Couldn't reach NanoGPT'", () => {
    expect(messageForCatalogError('network', { hasCache: false, now })).toMatch(
      /couldn['’]t reach nanogpt/i,
    );
  });

  it('network, with cache → mentions last-known list', () => {
    expect(
      messageForCatalogError('network', { hasCache: true, fetchedAt: fiveMinAgo, now }),
    ).toMatch(/last-known list/i);
  });

  it('other, no cache → "Unexpected response"', () => {
    expect(messageForCatalogError('other', { hasCache: false, now })).toMatch(
      /unexpected response/i,
    );
  });

  it('other, with cache → mentions last-known list', () => {
    expect(
      messageForCatalogError('other', { hasCache: true, fetchedAt: fiveMinAgo, now }),
    ).toMatch(/last-known list/i);
  });

  it('with-cache messages include a relative time', () => {
    const msg = messageForCatalogError('network', {
      hasCache: true,
      fetchedAt: fiveMinAgo,
      now,
    });
    expect(msg).toMatch(/5 min/);
  });
});
