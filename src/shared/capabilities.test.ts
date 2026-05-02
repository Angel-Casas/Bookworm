import { describe, expect, it } from 'vitest';
import { CAPABILITY_LABELS, checkCapabilities, type Capability } from './capabilities';

describe('capabilities', () => {
  it('has a label for every known capability', () => {
    const expected: readonly Capability[] = ['opfs', 'indexedDB', 'webCrypto', 'serviceWorker'];
    for (const cap of expected) {
      expect(CAPABILITY_LABELS[cap]).toBeTruthy();
      expect(typeof CAPABILITY_LABELS[cap]).toBe('string');
    }
  });

  it('returns a tagged result whose missing list (if any) only names known capabilities', () => {
    const result = checkCapabilities();
    if (result.kind === 'unsupported') {
      expect(Array.isArray(result.missing)).toBe(true);
      for (const cap of result.missing) {
        expect(CAPABILITY_LABELS[cap]).toBeTruthy();
      }
    } else {
      expect(result.kind).toBe('supported');
    }
  });
});
