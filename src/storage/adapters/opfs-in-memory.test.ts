import { describe, expect, it } from 'vitest';
import { createInMemoryOpfsAdapter } from './opfs-in-memory';

describe('inMemoryOpfsAdapter', () => {
  it('writes, reads, lists, and removes files recursively', async () => {
    const opfs = createInMemoryOpfsAdapter();

    await opfs.writeFile('books/abc/source.epub', new Blob(['hello']));
    await opfs.writeFile('books/abc/cover.png', new Blob(['cover']));
    await opfs.writeFile('books/xyz/source.pdf', new Blob(['pdf-bytes']));

    const sourceFile = await opfs.readFile('books/abc/source.epub');
    expect(sourceFile).toBeDefined();
    expect(await sourceFile!.text()).toBe('hello');

    expect(await opfs.list('books')).toEqual(expect.arrayContaining(['abc', 'xyz']));
    expect(await opfs.list('books/abc')).toEqual(
      expect.arrayContaining(['source.epub', 'cover.png']),
    );

    await opfs.removeRecursive('books/abc');
    expect(await opfs.readFile('books/abc/source.epub')).toBeUndefined();
    expect(await opfs.list('books')).toEqual(['xyz']);
  });

  it('returns undefined on missing file and empty list on missing dir', async () => {
    const opfs = createInMemoryOpfsAdapter();
    expect(await opfs.readFile('nope/file.txt')).toBeUndefined();
    expect(await opfs.list('nope')).toEqual([]);
  });
});
