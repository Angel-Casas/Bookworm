import type { OpfsAdapter } from './opfs';

export function createInMemoryOpfsAdapter(): OpfsAdapter {
  // Flat map keyed by full path. Directory existence is implied by file
  // entries; list() simulates directory traversal by string-prefix.
  const files = new Map<string, Blob>();

  const split = (path: string) => path.split('/').filter(Boolean);

  return {
    writeFile(path, blob) {
      files.set(split(path).join('/'), blob);
      return Promise.resolve();
    },
    readFile(path) {
      return Promise.resolve(files.get(split(path).join('/')));
    },
    removeRecursive(path) {
      const prefix = split(path).join('/');
      for (const key of [...files.keys()]) {
        if (key === prefix || key.startsWith(`${prefix}/`)) {
          files.delete(key);
        }
      }
      return Promise.resolve();
    },
    list(prefix) {
      const segments = split(prefix);
      const base = segments.join('/');
      const seen = new Set<string>();
      for (const key of files.keys()) {
        if (segments.length === 0 || key.startsWith(`${base}/`)) {
          const remainder = segments.length === 0 ? key : key.slice(base.length + 1);
          const head = remainder.split('/')[0];
          if (head) seen.add(head);
        }
      }
      return Promise.resolve([...seen]);
    },
  };
}
