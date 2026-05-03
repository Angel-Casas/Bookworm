import { setup, assign, fromPromise } from 'xstate';
import type { LocationAnchor, TocEntry } from '@/domain';
import type {
  BookReader,
  ReaderError,
  ReaderPreferences,
} from '@/domain/reader';

export type ReaderMachineInput = {
  loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  createAdapter: () => BookReader;
};

type Loaded = {
  blob: Blob;
  preferences: ReaderPreferences;
  initialAnchor?: LocationAnchor;
};

type Context = {
  bookId: string | null;
  adapter: BookReader | null;
  loaded: Loaded | null;
  toc: readonly TocEntry[] | null;
  currentAnchor: LocationAnchor | null;
  error: ReaderError | null;
  preferences: ReaderPreferences | null;
};

type Events =
  | { type: 'OPEN'; bookId: string }
  | { type: 'CLOSE' };

// Factory: deps are captured in closure rather than passed via XState input,
// because input is one-shot construction data; deps for our actors are
// callable references that the machine invokes repeatedly.
export function makeReaderMachine(deps: ReaderMachineInput) {
  return setup({
    types: { context: {} as Context, events: {} as Events },
    actors: {
      loadBookActor: fromPromise<Loaded, { bookId: string }>(({ input }) =>
        deps.loadBookForReader(input.bookId),
      ),
      openAdapterActor: fromPromise<
        { toc: readonly TocEntry[]; currentAnchor: LocationAnchor },
        { adapter: BookReader; loaded: Loaded }
      >(async ({ input }) => {
        const { toc } = await input.adapter.open(input.loaded.blob, {
          preferences: input.loaded.preferences,
          ...(input.loaded.initialAnchor && { initialAnchor: input.loaded.initialAnchor }),
        });
        const currentAnchor = input.adapter.getCurrentAnchor();
        return { toc, currentAnchor };
      }),
    },
    actions: {
      destroyAdapter: ({ context }) => {
        context.adapter?.destroy();
      },
    },
  }).createMachine({
    id: 'reader',
    initial: 'idle',
    context: {
      bookId: null,
      adapter: null,
      loaded: null,
      toc: null,
      currentAnchor: null,
      error: null,
      preferences: null,
    },
    states: {
      idle: {
        on: {
          OPEN: {
            target: 'loadingBlob',
            actions: assign({
              bookId: ({ event }) => event.bookId,
              error: null,
              adapter: null,
              loaded: null,
              toc: null,
              currentAnchor: null,
            }),
          },
        },
      },
      loadingBlob: {
        invoke: {
          src: 'loadBookActor',
          input: ({ context }) => {
            if (context.bookId === null) {
              throw new Error('readerMachine: bookId missing in loadingBlob');
            }
            return { bookId: context.bookId };
          },
          onDone: {
            target: 'opening',
            actions: assign({
              loaded: ({ event }) => event.output,
              preferences: ({ event }) => event.output.preferences,
            }),
          },
          onError: {
            target: 'error',
            actions: assign({
              error: ({ context }) => ({
                kind: 'blob-missing' as const,
                bookId: context.bookId ?? '',
              }),
            }),
          },
        },
        on: { CLOSE: { target: 'idle', actions: 'destroyAdapter' } },
      },
      opening: {
        entry: assign({
          adapter: () => deps.createAdapter(),
        }),
        invoke: {
          src: 'openAdapterActor',
          input: ({ context }) => {
            if (context.adapter === null || context.loaded === null) {
              throw new Error('readerMachine: adapter or loaded missing in opening');
            }
            return { adapter: context.adapter, loaded: context.loaded };
          },
          onDone: {
            target: 'ready',
            actions: assign({
              toc: ({ event }) => event.output.toc,
              currentAnchor: ({ event }) => event.output.currentAnchor,
            }),
          },
          onError: {
            target: 'error',
            actions: [
              'destroyAdapter',
              assign({
                error: () => ({ kind: 'parse-failed' as const, reason: 'engine open failed' }),
                adapter: null,
              }),
            ],
          },
        },
        on: { CLOSE: { target: 'idle', actions: 'destroyAdapter' } },
      },
      ready: {
        on: { CLOSE: { target: 'idle', actions: 'destroyAdapter' } },
      },
      error: {
        on: {
          CLOSE: { target: 'idle', actions: 'destroyAdapter' },
          OPEN: {
            target: 'loadingBlob',
            actions: assign({ bookId: ({ event }) => event.bookId, error: null }),
          },
        },
      },
    },
  });
}
