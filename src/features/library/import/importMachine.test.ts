import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { importMachine, type ImportInput, type ImportOutput } from './importMachine';
import { BookId, IsoTimestamp, type Book, type ParsedMetadata } from '@/domain';

const fakeFile = (byteValues: readonly number[], name: string, type: string): File => {
  const ab = new ArrayBuffer(byteValues.length);
  new Uint8Array(ab).set(byteValues);
  return new File([ab], name, { type });
};

const fakeBook: Book = {
  id: BookId('test'),
  title: 'Quiet Things',
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: 'books/test/source.epub',
    originalName: 'qt.epub',
    byteSize: 4,
    mimeType: 'application/epub+zip',
    checksum: 'a'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp('2024-01-01T00:00:00Z'),
  updatedAt: IsoTimestamp('2024-01-01T00:00:00Z'),
};

const fourBytes = (): ArrayBuffer => {
  const ab = new ArrayBuffer(4);
  new Uint8Array(ab).set([1, 2, 3, 4]);
  return ab;
};

const baseInput: ImportInput = {
  file: fakeFile([1, 2, 3, 4], 'qt.epub', 'application/epub+zip'),
  readBytes: () => Promise.resolve(fourBytes()),
  hashBytes: () => Promise.resolve('a'.repeat(64)),
  findByChecksum: () => Promise.resolve(undefined),
  parseInWorker: (): Promise<ParsedMetadata> =>
    Promise.resolve({ format: 'epub', title: 'Quiet Things' }),
  persistBook: () => Promise.resolve(fakeBook),
};

const runMachine = (input: ImportInput): Promise<ImportOutput> => {
  return new Promise((resolve) => {
    const actor = createActor(importMachine, { input });
    actor.subscribe({
      complete: () => {
        resolve(actor.getSnapshot().output!);
      },
    });
    actor.start();
  });
};

describe('importMachine', () => {
  it('happy path resolves to success', async () => {
    const result = await runMachine(baseInput);
    expect(result).toMatchObject({ kind: 'success' });
    if (result.kind === 'success') {
      expect(result.book.id).toBe('test');
    }
  });

  it('resolves to duplicate when checksum matches existing book', async () => {
    const result = await runMachine({
      ...baseInput,
      findByChecksum: () => Promise.resolve(fakeBook),
    });
    expect(result).toMatchObject({ kind: 'duplicate', existingBookId: 'test' });
  });

  it('resolves to failure when parsing throws', async () => {
    const result = await runMachine({
      ...baseInput,
      parseInWorker: () => Promise.reject(new Error('Not a valid EPUB')),
    });
    expect(result).toMatchObject({ kind: 'failure' });
    if (result.kind === 'failure') {
      expect(result.reason).toContain('Not a valid EPUB');
    }
  });

  it('resolves to failure when reading throws', async () => {
    const result = await runMachine({
      ...baseInput,
      readBytes: () => Promise.reject(new Error('disk on fire')),
    });
    expect(result).toMatchObject({ kind: 'failure' });
    if (result.kind === 'failure') {
      expect(result.reason).toContain("Couldn't read this file");
    }
  });

  it('resolves to failure when persisting throws', async () => {
    const result = await runMachine({
      ...baseInput,
      persistBook: () => Promise.reject(new Error('IDB exploded')),
    });
    expect(result).toMatchObject({ kind: 'failure' });
    if (result.kind === 'failure') {
      expect(result.reason).toContain("Couldn't save book");
    }
  });
});
