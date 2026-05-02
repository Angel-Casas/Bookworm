import { describe, expect, it } from 'vitest';
import { detectFormat } from './format';

const bytesOf = (s: string): ArrayBuffer => {
  const enc = new TextEncoder().encode(s);
  return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
};

describe('detectFormat', () => {
  it('detects PDF by %PDF- prefix', () => {
    expect(detectFormat(bytesOf('%PDF-1.7\n...'))).toBe('pdf');
  });
  it('detects EPUB by zip magic + epub mime', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const buf = new Uint8Array(zipMagic.length + 30);
    buf.set(zipMagic, 0);
    expect(detectFormat(buf.buffer)).toBe('epub');
  });
  it('returns null for unknown content', () => {
    expect(detectFormat(bytesOf('hello world'))).toBeNull();
  });
  it('returns null for empty bytes', () => {
    expect(detectFormat(new ArrayBuffer(0))).toBeNull();
  });
});
