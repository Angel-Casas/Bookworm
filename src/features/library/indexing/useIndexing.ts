import { useEffect, useRef } from 'react';
import type { BookId } from '@/domain';
import type { BookRepository, BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { IndexingQueue } from './IndexingQueue';

export type UseIndexingDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
};

export type UseIndexingHandle = {
  readonly enqueue: (id: BookId) => void;
  readonly rebuild: (id: BookId) => Promise<void>;
  readonly cancel: (id: BookId) => void;
};

export function useIndexing(deps: UseIndexingDeps): UseIndexingHandle {
  const queueRef = useRef<IndexingQueue | null>(null);
  queueRef.current ??= new IndexingQueue(deps);
  const queue = queueRef.current;

  useEffect(() => {
    void queue.onAppOpen();
  }, [queue]);

  return {
    enqueue: (id) => {
      queue.enqueue(id);
    },
    rebuild: (id) => queue.rebuild(id),
    cancel: (id) => {
      queue.cancel(id);
    },
  };
}
