import { describe, expect, it } from 'vitest';
import { l2Normalize } from './normalize';

describe('l2Normalize', () => {
  it('produces a unit vector for typical input', () => {
    const v = new Float32Array([3, 4]);
    const n = l2Normalize(v);
    const a = n[0] ?? 0;
    const b = n[1] ?? 0;
    const norm = Math.sqrt(a * a + b * b);
    expect(norm).toBeCloseTo(1, 5);
    expect(a).toBeCloseTo(0.6, 5);
    expect(b).toBeCloseTo(0.8, 5);
  });

  it('returns zero vector unchanged', () => {
    const n = l2Normalize(new Float32Array([0, 0, 0]));
    expect(Array.from(n)).toEqual([0, 0, 0]);
  });

  it('preserves an already-unit vector', () => {
    const n = l2Normalize(new Float32Array([1, 0, 0]));
    expect(n[0] ?? 0).toBeCloseTo(1, 5);
    expect(n[1] ?? 0).toBeCloseTo(0, 5);
  });

  it('does not mutate the input', () => {
    const v = new Float32Array([3, 4]);
    const before = Array.from(v);
    l2Normalize(v);
    expect(Array.from(v)).toEqual(before);
  });

  it('handles a 1536-dim vector', () => {
    const v = new Float32Array(1536);
    let i = 0;
    for (let k = 0; k < 1536; k += 1) {
      v[i] = (i % 11) + 1;
      i += 1;
    }
    const n = l2Normalize(v);
    let sumSq = 0;
    for (const x of n) sumSq += x * x;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 4);
  });
});
