/* eslint-disable @typescript-eslint/no-non-null-assertion --
   State-machine invariants guarantee context fields (bytes, checksum, metadata)
   are populated before the states that consume them. The non-null assertions
   reflect that ordering and are safer than throwing at runtime. */
import { assign, fromPromise, setup } from 'xstate';
import type { Book, BookId, ParsedMetadata } from '@/domain';

export type ImportInput = {
  readonly file: File;
  readBytes(file: File): Promise<ArrayBuffer>;
  hashBytes(bytes: ArrayBuffer): Promise<string>;
  findByChecksum(checksum: string): Promise<Book | undefined>;
  parseInWorker(args: {
    bytes: ArrayBuffer;
    mimeType: string;
    originalName: string;
  }): Promise<ParsedMetadata>;
  persistBook(args: {
    file: File;
    bytes: ArrayBuffer;
    metadata: ParsedMetadata;
    checksum: string;
  }): Promise<Book>;
};

type Context = {
  readonly deps: ImportInput;
  readonly file: File;
  bytes?: ArrayBuffer;
  checksum?: string;
  metadata?: ParsedMetadata;
  book?: Book;
  existingBookId?: BookId;
  reason?: string;
};

export type ImportOutput =
  | { kind: 'success'; book: Book }
  | { kind: 'duplicate'; existingBookId: BookId }
  | { kind: 'failure'; reason: string; fileName: string };

const readBytes = fromPromise(
  ({ input }: { input: { deps: ImportInput; file: File } }) => input.deps.readBytes(input.file),
);

const hashBytes = fromPromise(
  ({ input }: { input: { deps: ImportInput; bytes: ArrayBuffer } }) =>
    input.deps.hashBytes(input.bytes),
);

const findByChecksum = fromPromise(
  ({ input }: { input: { deps: ImportInput; checksum: string } }) =>
    input.deps.findByChecksum(input.checksum),
);

const parseInWorker = fromPromise(
  ({
    input,
  }: {
    input: { deps: ImportInput; bytes: ArrayBuffer; mimeType: string; originalName: string };
  }) =>
    input.deps.parseInWorker({
      bytes: input.bytes,
      mimeType: input.mimeType,
      originalName: input.originalName,
    }),
);

const persistBook = fromPromise(
  ({
    input,
  }: {
    input: {
      deps: ImportInput;
      file: File;
      bytes: ArrayBuffer;
      metadata: ParsedMetadata;
      checksum: string;
    };
  }) =>
    input.deps.persistBook({
      file: input.file,
      bytes: input.bytes,
      metadata: input.metadata,
      checksum: input.checksum,
    }),
);

export const importMachine = setup({
  types: {
    input: {} as ImportInput,
    context: {} as Context,
    output: {} as ImportOutput,
  },
  actors: {
    readBytes,
    hashBytes,
    findByChecksum,
    parseInWorker,
    persistBook,
  },
}).createMachine({
  id: 'import',
  initial: 'reading',
  context: ({ input }) => ({ deps: input, file: input.file }) satisfies Context,
  output: ({ context }): ImportOutput => {
    if (context.book) return { kind: 'success', book: context.book };
    if (context.existingBookId)
      return { kind: 'duplicate', existingBookId: context.existingBookId };
    return {
      kind: 'failure',
      reason: context.reason ?? 'Unknown error.',
      fileName: context.file.name,
    };
  },
  states: {
    reading: {
      invoke: {
        src: 'readBytes',
        input: ({ context }) => ({ deps: context.deps, file: context.file }),
        onDone: {
          target: 'hashing',
          actions: assign({ bytes: ({ event }) => event.output }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            reason: ({ event }) =>
              event.error instanceof Error
                ? `Couldn't read this file (${event.error.message}).`
                : "Couldn't read this file.",
          }),
        },
      },
    },
    hashing: {
      invoke: {
        src: 'hashBytes',
        input: ({ context }) => ({ deps: context.deps, bytes: context.bytes! }),
        onDone: {
          target: 'dedupCheck',
          actions: assign({ checksum: ({ event }) => event.output }),
        },
        onError: {
          target: 'failed',
          actions: assign({ reason: () => 'Hashing failed.' }),
        },
      },
    },
    dedupCheck: {
      invoke: {
        src: 'findByChecksum',
        input: ({ context }) => ({ deps: context.deps, checksum: context.checksum! }),
        onDone: [
          {
            guard: ({ event }) => Boolean(event.output),
            target: 'duplicate',
            actions: assign({
              existingBookId: ({ event }) => event.output!.id,
            }),
          },
          { target: 'parsing' },
        ],
        onError: {
          target: 'failed',
          actions: assign({ reason: () => "Couldn't check for duplicates." }),
        },
      },
    },
    parsing: {
      invoke: {
        src: 'parseInWorker',
        input: ({ context }) => ({
          deps: context.deps,
          bytes: context.bytes!,
          mimeType: context.file.type,
          originalName: context.file.name,
        }),
        onDone: {
          target: 'persisting',
          actions: assign({ metadata: ({ event }) => event.output }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            reason: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Parse failed.',
          }),
        },
      },
    },
    persisting: {
      invoke: {
        src: 'persistBook',
        input: ({ context }) => ({
          deps: context.deps,
          file: context.file,
          bytes: context.bytes!,
          metadata: context.metadata!,
          checksum: context.checksum!,
        }),
        onDone: {
          target: 'done',
          actions: assign({ book: ({ event }) => event.output }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            reason: ({ event }) => {
              if (event.error instanceof Error) {
                if (event.error.name === 'QuotaExceededError') {
                  return 'Browser ran out of storage.';
                }
                return `Couldn't save book (${event.error.message}).`;
              }
              return "Couldn't save book.";
            },
          }),
        },
      },
    },
    done: { type: 'final' },
    duplicate: { type: 'final' },
    failed: { type: 'final' },
  },
});
