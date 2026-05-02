import type { BookFormat } from '@/domain';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function startsWith(view: Uint8Array, magic: readonly number[]): boolean {
  if (view.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (view[i] !== magic[i]) return false;
  }
  return true;
}

export function detectFormat(bytes: ArrayBuffer): BookFormat | null {
  if (bytes.byteLength === 0) return null;
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16));
  if (startsWith(view, PDF_MAGIC)) return 'pdf';
  if (startsWith(view, ZIP_MAGIC)) return 'epub';
  return null;
}
