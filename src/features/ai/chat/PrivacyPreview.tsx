import { useEffect, useState } from 'react';
import { buildOpenModeSystemPrompt, buildPassageBlockForPreview } from './promptAssembly';
import type { AttachedPassage, AttachedRetrieval } from './useChatSend';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';

type Props = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly modelId: string;
  readonly historyCount: number;
  // Phase 4.4. When non-null, summary + expanded form gain a passage section.
  readonly attachedPassage?: AttachedPassage | null;
  // Phase 5.2. When non-null, summary + expanded form gain a search-plan section.
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly chunksRepo?: BookChunksRepository;
  readonly embeddingsRepo?: BookEmbeddingsRepository;
};

export function PrivacyPreview({
  book,
  modelId,
  historyCount,
  attachedPassage,
  attachedRetrieval,
  chunksRepo,
  embeddingsRepo,
}: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const [counts, setCounts] = useState<{ chunks: number; embeddings: number } | null>(null);
  const passage = attachedPassage ?? null;
  const retrieval = attachedRetrieval ?? null;

  useEffect(() => {
    if (retrieval === null || chunksRepo === undefined || embeddingsRepo === undefined) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [chunks, embeddings] = await Promise.all([
        chunksRepo.countByBook(retrieval.bookId),
        embeddingsRepo.countByBook(retrieval.bookId),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) return;
      setCounts({ chunks, embeddings });
    })();
    return () => {
      cancelled = true;
    };
  }, [retrieval, chunksRepo, embeddingsRepo]);

  const summaryParts: string[] = [
    `${book.title}${book.author ? ` by ${book.author}` : ''}`,
  ];
  if (retrieval !== null) {
    summaryParts.push('search this book');
  } else if (passage !== null) {
    if (passage.sectionTitle !== undefined) summaryParts.push(passage.sectionTitle);
    summaryParts.push(`selected passage (~${String(passage.text.length)} chars)`);
  }
  summaryParts.push(`${String(historyCount)} prior messages`);
  const summary = `Sending: ${summaryParts.join(' + ')} → ${modelId}`;

  const prompt = buildOpenModeSystemPrompt(book);

  const passageBlock =
    passage !== null && retrieval === null
      ? buildPassageBlockForPreview(book.title, {
          text: passage.text,
          ...(passage.sectionTitle !== undefined && { sectionTitle: passage.sectionTitle }),
          ...(passage.windowBefore !== undefined && { windowBefore: passage.windowBefore }),
          ...(passage.windowAfter !== undefined && { windowAfter: passage.windowAfter }),
        })
      : null;

  return (
    <div className={open ? 'privacy-preview privacy-preview--open' : 'privacy-preview'}>
      <button
        type="button"
        className="privacy-preview__summary"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        ⓘ {summary}
      </button>
      {open ? (
        <div className="privacy-preview__body">
          <h4>System prompt</h4>
          <pre className="privacy-preview__prompt">{prompt}</pre>
          {passageBlock !== null ? (
            <>
              <h4>Attached passage</h4>
              <pre className="privacy-preview__prompt">{passageBlock}</pre>
            </>
          ) : null}
          {retrieval !== null ? (
            <>
              <h4>Search plan</h4>
              {counts === null ? (
                <p>Counting…</p>
              ) : counts.embeddings === 0 ? (
                <p className="privacy-preview__warning">
                  This book is still being prepared for AI. Sending now will return
                  &ldquo;no embeddings yet&rdquo;. Wait for the library card to show ✓ Indexed.
                </p>
              ) : (
                <p>
                  This book — {String(counts.chunks)} chunks · embeddings ready. Will fetch up
                  to 12 chunks / ~3000 tokens of the most relevant excerpts to {modelId}. The
                  actual excerpts depend on your question.
                </p>
              )}
            </>
          ) : null}
          <h4>Model</h4>
          <p>{modelId}</p>
          <h4>Messages included</h4>
          <p>1 system + {historyCount} prior</p>
        </div>
      ) : null}
    </div>
  );
}
