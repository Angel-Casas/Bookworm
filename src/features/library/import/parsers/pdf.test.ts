// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePdfMetadata } from './pdf';

describe('parsePdfMetadata', () => {
  it('reads /Info title and author from the text-friendly fixture', async () => {
    const buf = await readFile(resolve(process.cwd(), 'test-fixtures/text-friendly.pdf'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const meta = await parsePdfMetadata(ab, 'text-friendly.pdf');
    if (meta.kind !== 'ok') {
      throw new Error(`Expected ok, got error: ${meta.reason}`);
    }
    expect(meta.metadata.title).toBe('Text-Friendly PDF');
    expect(meta.metadata.author).toBe('Bookworm Test Suite');
  });
});
