import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { makeReaderMachine } from './readerMachine';
import { DEFAULT_READER_PREFERENCES } from '@/domain/reader';
import type { LocationAnchor } from '@/domain';
import type { BookReader } from '@/domain/reader';

function fakeAdapter(): BookReader & { destroyed: boolean } {
  const out = {
    destroyed: false,
    open: () =>
      Promise.resolve({
        toc: [
          {
            id: 'c1' as never,
            title: 'Chapter 1',
            depth: 0,
            anchor: { kind: 'epub-cfi' as const, cfi: 'a' },
          },
        ],
      }),
    goToAnchor: () => Promise.resolve(),
    getCurrentAnchor(): LocationAnchor {
      return { kind: 'epub-cfi', cfi: 'a' };
    },
    applyPreferences() {
      // noop
    },
    onLocationChange() {
      return () => undefined;
    },
    destroy() {
      out.destroyed = true;
    },
  };
  return out;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('readerMachine', () => {
  it('idle → loadingBlob → opening → ready on the happy path', async () => {
    const adapter = fakeAdapter();
    const machine = makeReaderMachine({
      loadBookForReader: () =>
        Promise.resolve({
          blob: new Blob(['x']),
          preferences: DEFAULT_READER_PREFERENCES,
        }),
      createAdapter: () => adapter,
    });
    const actor = createActor(machine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.send({ type: 'OPEN', bookId: 'b1' });
    await settle();
    expect(actor.getSnapshot().value).toBe('ready');
    expect(actor.getSnapshot().context.toc?.length).toBeGreaterThan(0);
    actor.stop();
  });

  it('transitions to error if loadBookForReader throws', async () => {
    const machine = makeReaderMachine({
      loadBookForReader: () => Promise.reject(new Error('blob missing')),
      createAdapter: () => fakeAdapter(),
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'OPEN', bookId: 'b1' });
    await settle();
    expect(actor.getSnapshot().value).toBe('error');
    expect(actor.getSnapshot().context.error?.kind).toBe('blob-missing');
    actor.stop();
  });

  it('CLOSE always destroys the adapter', async () => {
    const adapter = fakeAdapter();
    const machine = makeReaderMachine({
      loadBookForReader: () =>
        Promise.resolve({
          blob: new Blob(['x']),
          preferences: DEFAULT_READER_PREFERENCES,
        }),
      createAdapter: () => adapter,
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'OPEN', bookId: 'b1' });
    await settle();
    expect(actor.getSnapshot().value).toBe('ready');
    actor.send({ type: 'CLOSE' });
    expect(adapter.destroyed).toBe(true);
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('engine error transitions to error and destroys adapter', async () => {
    const adapter: BookReader & { destroyed: boolean } = {
      destroyed: false,
      open: () => Promise.reject(new Error('boom')),
      goToAnchor: () => Promise.resolve(),
      getCurrentAnchor: () => ({ kind: 'epub-cfi', cfi: '' }),
      applyPreferences: () => undefined,
      onLocationChange: () => () => undefined,
      destroy() {
        this.destroyed = true;
      },
    };
    const machine = makeReaderMachine({
      loadBookForReader: () =>
        Promise.resolve({
          blob: new Blob(['x']),
          preferences: DEFAULT_READER_PREFERENCES,
        }),
      createAdapter: () => adapter,
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'OPEN', bookId: 'b1' });
    await settle();
    expect(actor.getSnapshot().value).toBe('error');
    expect(actor.getSnapshot().context.error?.kind).toBe('parse-failed');
    expect(adapter.destroyed).toBe(true);
    actor.stop();
  });
});
