export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return new Float32Array(vec);
  const out = new Float32Array(vec.length);
  let i = 0;
  for (const x of vec) {
    out[i] = x / norm;
    i += 1;
  }
  return out;
}
