import { createStore, type StoreApi } from 'zustand/vanilla';
import { createActor } from 'xstate';
import type { Book, BookId, ImportResult } from '@/domain';
import { importMachine, type ImportInput, type ImportOutput } from './importMachine';

export type ImportEntryStatus =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly book: Book }
  | { readonly kind: 'duplicate'; readonly existingBookId: BookId }
  | { readonly kind: 'failed'; readonly reason: string };

export type ImportEntry = {
  readonly id: string;
  readonly fileName: string;
  readonly addedAt: number;
  readonly status: ImportEntryStatus;
};

export type ImportRunnerDeps = Omit<ImportInput, 'file'>;

export type ImportState = {
  readonly entries: readonly ImportEntry[];
  enqueue(file: File): string;
  dismiss(id: string): void;
  clearTerminal(): void;
};

export type ImportStore = StoreApi<ImportState>;

export function createImportStore(deps: ImportRunnerDeps): ImportStore {
  let processing = false;
  const pendingFiles = new Map<string, File>();

  const store = createStore<ImportState>((set) => ({
    entries: [],
    enqueue(file) {
      const id = crypto.randomUUID();
      set((s) => ({
        entries: [
          ...s.entries,
          {
            id,
            fileName: file.name,
            addedAt: Date.now(),
            status: { kind: 'waiting' },
          },
        ],
      }));
      pendingFiles.set(id, file);
      void processNext();
      return id;
    },
    dismiss(id) {
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    },
    clearTerminal() {
      set((s) => ({
        entries: s.entries.filter(
          (e) => e.status.kind === 'waiting' || e.status.kind === 'running',
        ),
      }));
    },
  }));

  const updateEntry = (id: string, status: ImportEntryStatus): void => {
    store.setState((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, status } : e)),
    }));
  };

  async function processNext(): Promise<void> {
    if (processing) return;
    const next = store.getState().entries.find((e) => e.status.kind === 'waiting');
    if (!next) return;
    const file = pendingFiles.get(next.id);
    if (!file) {
      updateEntry(next.id, { kind: 'failed', reason: 'Lost file reference.' });
      return processNext();
    }
    processing = true;
    updateEntry(next.id, { kind: 'running' });
    try {
      const output = await runOne({ file, ...deps });
      const status: ImportEntryStatus =
        output.kind === 'success'
          ? { kind: 'done', book: output.book }
          : output.kind === 'duplicate'
            ? { kind: 'duplicate', existingBookId: output.existingBookId }
            : { kind: 'failed', reason: output.reason };
      updateEntry(next.id, status);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error.';
      updateEntry(next.id, { kind: 'failed', reason });
    } finally {
      pendingFiles.delete(next.id);
      processing = false;
      void processNext();
    }
  }

  async function runOne(input: ImportInput): Promise<ImportOutput> {
    return new Promise<ImportOutput>((resolve, reject) => {
      const actor = createActor(importMachine, { input });
      actor.subscribe({
        complete: () => {
          const output = actor.getSnapshot().output;
          if (output) resolve(output);
          else reject(new Error('Import machine completed without output.'));
        },
      });
      actor.start();
    });
  }

  return store;
}

export function toImportResult(entry: ImportEntry): ImportResult | undefined {
  if (entry.status.kind === 'done') return { kind: 'success', book: entry.status.book };
  if (entry.status.kind === 'duplicate')
    return { kind: 'duplicate', existingBookId: entry.status.existingBookId };
  if (entry.status.kind === 'failed')
    return { kind: 'failure', reason: entry.status.reason, fileName: entry.fileName };
  return undefined;
}
