import { describe, expect, it } from 'vitest';
import { isValidContextRef } from './contextRefValidation';

describe('isValidContextRef — passage variant', () => {
  it('accepts a well-formed passage ref', () => {
    expect(
      isValidContextRef({
        kind: 'passage',
        text: 'hello',
        anchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
      }),
    ).toBe(true);
  });

  it('rejects a passage ref missing anchor', () => {
    expect(isValidContextRef({ kind: 'passage', text: 'hello' })).toBe(false);
  });
});

describe('isValidContextRef — chunk variant (Phase 5.2)', () => {
  it('accepts a chunk ref with a non-empty chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk', chunkId: 'chunk-b1-s1-0' })).toBe(true);
  });

  it('rejects chunk ref with missing chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk' })).toBe(false);
  });

  it('rejects chunk ref with empty chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk', chunkId: '' })).toBe(false);
  });

  it('rejects chunk ref with non-string chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk', chunkId: 42 })).toBe(false);
  });
});

describe('isValidContextRef — highlight / section pass-through', () => {
  it('accepts highlight ref', () => {
    expect(isValidContextRef({ kind: 'highlight' })).toBe(true);
  });

  it('accepts section ref', () => {
    expect(isValidContextRef({ kind: 'section' })).toBe(true);
  });
});

describe('isValidContextRef — invalid inputs', () => {
  it('rejects null', () => {
    expect(isValidContextRef(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidContextRef(undefined)).toBe(false);
  });

  it('rejects unknown kind', () => {
    expect(isValidContextRef({ kind: 'unknown' })).toBe(false);
  });
});
