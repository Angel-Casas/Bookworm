import { useEffect, useRef } from 'react';
import type { Book, BookId } from '@/domain';
import type {
  BookChunksRepository,
  BookEmbeddingsRepository,
  BookRepository,
} from '@/storage';
import type { ChunkExtractor } from './extractor';
import type { EmbedClient } from './embeddings/types';
import { IndexingQueue } from './IndexingQueue';

export type UseIndexingDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;
  // Fired after each pipeline status transition (chunking %, embedding %,
  // ready, failed). App.tsx wires this to libraryStore.upsertBook so the
  // library card reflects live indexing progress without a page reload.
  readonly onBookStatusChange?: (book: Book) => void;
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
