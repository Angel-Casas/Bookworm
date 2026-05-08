import { useCallback } from 'react';
import {
  trayReduce,
  type AttachedExcerpt,
  type AttachedMultiExcerpt,
} from '@/domain/ai/multiExcerpt';

type SetActive = (
  kind: 'none' | 'multi-excerpt',
  payload?: AttachedMultiExcerpt | null,
) => void;

type Args = {
  readonly tray: AttachedMultiExcerpt | null;
  readonly setActiveAttachment: SetActive;
};

export type UseMultiExcerptTrayHandle = {
  readonly add: (excerpt: AttachedExcerpt) => 'ok' | 'full' | 'duplicate';
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly contains: (id: string) => boolean;
};

export function useMultiExcerptTray(args: Args): UseMultiExcerptTrayHandle {
  const { tray, setActiveAttachment } = args;

  const add = useCallback(
    (excerpt: AttachedExcerpt): 'ok' | 'full' | 'duplicate' => {
      const reduced = trayReduce(tray, { type: 'add', excerpt });
      if (reduced.result === 'ok' && reduced.tray !== null) {
        setActiveAttachment('multi-excerpt', reduced.tray);
        return 'ok';
      }
      // 'duplicate' or 'full' — leave tray untouched.
      return reduced.result === 'full' ? 'full' : 'duplicate';
    },
    [tray, setActiveAttachment],
  );

  const remove = useCallback(
    (id: string): void => {
      const reduced = trayReduce(tray, { type: 'remove', id });
      if (reduced.tray === null) {
        setActiveAttachment('none');
        return;
      }
      setActiveAttachment('multi-excerpt', reduced.tray);
    },
    [tray, setActiveAttachment],
  );

  const clear = useCallback((): void => {
    setActiveAttachment('none');
  }, [setActiveAttachment]);

  const contains = useCallback(
    (id: string): boolean => tray?.excerpts.some((e) => e.id === id) ?? false,
    [tray],
  );

  return { add, remove, clear, contains };
}
