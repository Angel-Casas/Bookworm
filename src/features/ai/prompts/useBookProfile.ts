import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookProfileRecord } from '@/domain';
import type { StructuredFailure } from '@/features/ai/chat/nanogptStructured';
import {
  runProfileGeneration,
  type ProfileGenerationDeps,
} from './runProfileGeneration';

export type UseBookProfileState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly record: BookProfileRecord }
  | { readonly status: 'no-chunks' }
  | { readonly status: 'failed'; readonly reason: StructuredFailure['reason'] };

export type UseBookProfileHandle = UseBookProfileState & {
  readonly retry: () => void;
};

export type UseBookProfileArgs = {
  readonly book: Pick<Book, 'id' | 'title' | 'author' | 'toc'>;
  readonly modelId: string | null;
  readonly enabled: boolean;
  readonly deps: ProfileGenerationDeps;
};

export function useBookProfile(args: UseBookProfileArgs): UseBookProfileHandle {
  const [state, setState] = useState<UseBookProfileState>({ status: 'idle' });
  const [retryToken, setRetryToken] = useState<number>(0);
  const argsRef = useRef(args);

  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  // Dedup is owned by the abort signal, not a boolean flag. A boolean flag
  // deadlocks under StrictMode's double-invoke: mount #1 sets flag→true,
  // cleanup aborts signal #1 but flag stays true while the async work
  // unwinds; mount #2 sees flag===true and returns early; nothing re-fires.
  // With signal-only dedup, mount #1's run hits its first signal.aborted
  // check post-await and bails before any state set; mount #2's run
  // proceeds normally. Worst case: one extra cached-profile read per mount
  // pair (cheap IDB lookup); the structured request still fires at most
  // once because the first run aborts before reaching it.
  const run = useCallback(async (signal: AbortSignal): Promise<void> => {
    const a = argsRef.current;
    if (!a.enabled || a.modelId === null) return;

    const cached = await a.deps.profilesRepo.get(a.book.id);
    if (signal.aborted) return;
    if (cached !== null) {
      setState({ status: 'ready', record: cached });
      return;
    }
    setState({ status: 'loading' });
    const result = await runProfileGeneration({
      book: a.book,
      modelId: a.modelId,
      deps: a.deps,
      signal,
    });
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- signal can flip during the await; TS narrows from prior check
    if (signal.aborted) return;
    if (result.kind === 'ok') setState({ status: 'ready', record: result.record });
    else if (result.kind === 'no-chunks') setState({ status: 'no-chunks' });
    else if (result.kind === 'failed') setState({ status: 'failed', reason: result.reason });
    // 'aborted' → no state change (cleanup ran).
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void run(ctrl.signal);
    return () => {
      ctrl.abort();
    };
  }, [args.book.id, args.modelId, args.enabled, retryToken, run]);

  const retry = useCallback((): void => {
    setRetryToken((t) => t + 1);
    setState({ status: 'idle' });
  }, []);

  return { ...state, retry };
}
