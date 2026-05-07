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

  it('invalid-key (server 401/403) → embedding-no-key', () => {
    expect(classifyEmbeddingError(fakeEmbedError('invalid-key', { status: 401 }))).toBe(
      'embedding-no-key',
    );
  });

  it('invalid-key (local short-circuit, status 0) → embedding-no-key', () => {
    // The empty-apiKey short-circuit in nanogptEmbeddings.embed throws
    // {reason: 'invalid-key', status: 0} without making a network call.
    // Should still classify as the actionable no-key card state.
    expect(classifyEmbeddingError(fakeEmbedError('invalid-key', { status: 0 }))).toBe(
      'embedding-no-key',
    );
  });

  it('insufficient-balance → embedding-insufficient-balance', () => {
    expect(
      classifyEmbeddingError(fakeEmbedError('insufficient-balance', { status: 402 })),
    ).toBe('embedding-insufficient-balance');
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
