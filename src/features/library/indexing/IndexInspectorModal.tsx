import { useEffect, useMemo, useState } from 'react';
import type { BookEmbedding, BookId, TextChunk } from '@/domain';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import { IndexInspectorChunkRow } from './IndexInspectorChunkRow';

type Props = {
  readonly bookId: BookId;
  readonly bookTitle: string;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly onRebuild: (id: BookId) => Promise<void>;
  readonly onClose: () => void;
};

export function IndexInspectorModal({
  bookId,
  bookTitle,
  chunksRepo,
  embeddingsRepo,
  onRebuild,
  onClose,
}: Props) {
  const [chunks, setChunks] = useState<readonly TextChunk[] | null>(null);
  const [embeddings, setEmbeddings] = useState<readonly BookEmbedding[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void chunksRepo.listByBook(bookId).then(setChunks);
    void embeddingsRepo.listByBook(bookId).then(setEmbeddings);
  }, [bookId, chunksRepo, embeddingsRepo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const summary = useMemo(() => {
    if (chunks === null) return null;
    const sectionCount = new Set(chunks.map((c) => c.sectionId)).size;
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenEstimate, 0);
    const version = chunks[0]?.chunkerVersion ?? 0;
    const embeddingsCount = embeddings?.length ?? 0;
    const embeddingModelVersion = embeddings?.[0]?.embeddingModelVersion ?? 0;
    return {
      count: chunks.length,
      sectionCount,
      totalTokens,
      version,
      embeddingsCount,
      embeddingModelVersion,
    };
  }, [chunks, embeddings]);

  const handleRebuild = async (): Promise<void> => {
    await onRebuild(bookId);
    onClose();
  };

  return (
    <div className="index-inspector__backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="index-inspector-title"
        className="index-inspector"
      >
        <header className="index-inspector__header">
          <h2 id="index-inspector-title">Index inspector — {bookTitle}</h2>
          <button
            type="button"
            className="index-inspector__close"
            aria-label="Close inspector"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {summary !== null ? (
          <div className="index-inspector__summary">
            <span>
              {summary.count} chunks · {summary.sectionCount} sections · v
              {summary.version} chunker · ~{summary.totalTokens} tokens ·{' '}
              {summary.embeddingsCount}/{summary.count} embeddings · v
              {summary.embeddingModelVersion} model
            </span>
            <button
              type="button"
              className="index-inspector__rebuild"
              onClick={() => {
                void handleRebuild();
              }}
            >
              Rebuild index
            </button>
          </div>
        ) : (
          <p className="index-inspector__loading">Loading…</p>
        )}
        <div className="index-inspector__rows">
          {chunks?.map((chunk, index) => (
            <IndexInspectorChunkRow
              key={chunk.id}
              chunk={chunk}
              index={index}
              total={chunks.length}
              expanded={expandedId === chunk.id}
              onToggle={() => {
                setExpandedId((cur) => (cur === chunk.id ? null : chunk.id));
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
