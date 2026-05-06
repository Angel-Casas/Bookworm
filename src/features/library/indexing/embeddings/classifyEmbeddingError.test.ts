import { describe, expect, it } from 'vitest';
import { classifyEmbeddingError } from './classifyEmbeddingError';

function fakeEmbedError(reason: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`embed: ${reason}`), {
    failure: { reason, ...extra },
  });
}

describe('classifyEmbeddingError', () => {
  it('rate-limit → embedding-rate-limited', () => {
    expect(classifyEmbeddingError(fakeEmbedError('rate-limit', { status: 429 }))).toBe(
      'embedding-rate-limited',
    );
  });

  it('invalid-key → embedding-failed', () => {
    expect(classifyEmbeddingError(fakeEmbedError('invalid-key', { status: 401 }))).toBe(
      'embedding-failed',
    );
  });

  it('network → embedding-failed', () => {
    expect(classifyEmbeddingError(fakeEmbedError('network'))).toBe('embedding-failed');
  });

  it('unknown error → embedding-failed', () => {
    expect(classifyEmbeddingError(new Error('boom'))).toBe('embedding-failed');
  });

  it('non-error value → embedding-failed', () => {
    expect(classifyEmbeddingError('boom')).toBe('embedding-failed');
  });
});
