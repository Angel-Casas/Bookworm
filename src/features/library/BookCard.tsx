import { useEffect, useState } from 'react';
import type { Book, BookId } from '@/domain';
import type { CoverCache } from './store/coverCache';
import { BookCardMenu } from './BookCardMenu';
import { BookCardIndexingStatus } from './indexing/BookCardIndexingStatus';
import './book-card.css';

type Props = {
  readonly book: Book;
  readonly coverCache: CoverCache;
  readonly onRemove: (book: Book) => void;
  readonly onOpen?: (book: Book) => void;
  readonly onOpenInspector?: (bookId: BookId) => void;
  readonly onRetryIndex?: (bookId: BookId) => void;
};

export function BookCard({
  book,
  coverCache,
  onRemove,
  onOpen,
  onOpenInspector,
  onRetryIndex,
}: Props) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void coverCache.getUrl(book).then((url) => {
      if (!cancelled) setCoverUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [book, coverCache]);

  return (
    <article className="book-card" data-book-id={book.id}>
      <button
        type="button"
        className="book-card__open"
        onClick={() => onOpen?.(book)}
        disabled={!onOpen}
        aria-label={`Open ${book.title}`}
      >
        {coverUrl ? (
          <img className="book-card__cover" src={coverUrl} alt="" />
        ) : (
          <div className="book-card__cover book-card__cover--blank" aria-hidden="true">
            <span className="book-card__cover-fallback-title">{book.title}</span>
          </div>
        )}
        <div className="book-card__title">{book.title}</div>
        <div className="book-card__author">{book.author ?? ''}</div>
      </button>
      {onOpenInspector !== undefined && onRetryIndex !== undefined ? (
        <BookCardIndexingStatus
          book={book}
          onOpenInspector={() => {
            onOpenInspector(book.id);
          }}
          onRetry={() => {
            onRetryIndex(book.id);
          }}
        />
      ) : null}
      <BookCardMenu
        onRemove={() => {
          onRemove(book);
        }}
      />
    </article>
  );
}
