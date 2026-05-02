// OpfsAdapter is the only allowed surface for OPFS access. The real adapter
// is wired in production; tests inject the in-memory variant.

export type OpfsAdapter = {
  writeFile(path: string, blob: Blob): Promise<void>;
  readFile(path: string): Promise<Blob | undefined>;
  removeRecursive(path: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
};

export class OpfsError extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown, message: string) {
    super(message);
    this.name = 'OpfsError';
    this.cause = cause;
  }
}

// Real OPFS implementation. Path segments separated by '/'.
export function createOpfsAdapter(): OpfsAdapter {
  const storage =
    typeof navigator !== 'undefined'
      ? (navigator.storage as StorageManager | undefined)
      : undefined;
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new OpfsError(undefined, 'OPFS unavailable in this environment.');
  }
  const root: StorageManager = storage;

  async function getDirHandle(
    parts: readonly string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let dir = await root.getDirectory();
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  async function getFileHandleAt(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const segments = path.split('/').filter(Boolean);
    const fileName = segments.at(-1);
    if (!fileName) {
      throw new OpfsError(undefined, 'Empty path');
    }
    const dirSegments = segments.slice(0, -1);
    const dir = await getDirHandle(dirSegments, create);
    return dir.getFileHandle(fileName, { create });
  }

  return {
    async writeFile(path, blob) {
      try {
        const handle = await getFileHandleAt(path, true);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (err) {
        throw new OpfsError(err, `OPFS write failed at ${path}`);
      }
    },

    async readFile(path) {
      try {
        const handle = await getFileHandleAt(path, false);
        return await handle.getFile();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') {
          return undefined;
        }
        throw new OpfsError(err, `OPFS read failed at ${path}`);
      }
    },

    async removeRecursive(path) {
      const segments = path.split('/').filter(Boolean);
      const last = segments.at(-1);
      if (!last) return;
      try {
        const parent = await getDirHandle(segments.slice(0, -1), false);
        await parent.removeEntry(last, { recursive: true });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return;
        throw new OpfsError(err, `OPFS removeRecursive failed at ${path}`);
      }
    },

    async list(prefix) {
      const segments = prefix.split('/').filter(Boolean);
      try {
        const dir = await getDirHandle(segments, false);
        const names: string[] = [];
        for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
          names.push(name);
        }
        return names;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return [];
        throw new OpfsError(err, `OPFS list failed at ${prefix}`);
      }
    },
  };
}
