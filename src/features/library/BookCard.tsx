import { useEffect, useState } from 'react';
import type { Book } from '@/domain';
import type { CoverCache } from './store/coverCache';
import { BookCardMenu } from './BookCardMenu';
import './book-card.css';

type Props = {
  readonly book: Book;
  readonly coverCache: CoverCache;
  readonly onRemove: (book: Book) => void;
  readonly onOpen?: (book: Book) => void;
};

export function BookCard({ book, coverCache, onRemove, onOpen }: Props) {
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
      <BookCardMenu
        onRemove={() => {
          onRemove(book);
        }}
      />
    </article>
  );
}
