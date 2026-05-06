import { describe, it, expect } from 'vitest';
import { classifyError } from './classifyError';

describe('classifyError', () => {
  it('classifies "no text" / "empty" errors as no-text-found', () => {
    expect(classifyError(new Error('no text content found'))).toBe('no-text-found');
    expect(classifyError(new Error('Empty document'))).toBe('no-text-found');
  });

  it('classifies parser/extraction errors as extract-failed', () => {
    expect(classifyError(new Error('Invalid EPUB'))).toBe('extract-failed');
    expect(classifyError(new Error('Failed to parse PDF outline'))).toBe('extract-failed');
    expect(classifyError(new Error('PasswordException: encrypted'))).toBe('extract-failed');
  });

  it('classifies IDB / quota errors as persist-failed', () => {
    const quotaErr = new Error('QuotaExceededError');
    expect(classifyError(quotaErr)).toBe('persist-failed');
    const idbErr = new Error('Transaction aborted');
    expect(classifyError(idbErr)).toBe('persist-failed');
  });

  it('falls through to unknown for unrecognized errors', () => {
    expect(classifyError(new Error('asdf'))).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError({ weird: true })).toBe('unknown');
  });
});
