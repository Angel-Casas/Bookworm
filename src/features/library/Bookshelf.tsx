import type { Book } from '@/domain';
import { BookCard } from './BookCard';
import type { CoverCache } from './store/coverCache';
import './bookshelf.css';

type Props = {
  readonly books: readonly Book[];
  readonly coverCache: CoverCache;
  readonly searchQuery: string;
  readonly onRemove: (book: Book) => void;
  readonly onOpenBook?: (book: Book) => void;
};

export function Bookshelf({ books, coverCache, searchQuery, onRemove, onOpenBook }: Props) {
  const trimmed = searchQuery.trim();
  if (books.length === 0 && trimmed.length > 0) {
    return (
      <section className="bookshelf bookshelf--empty-search">
        <p className="bookshelf__no-results">No books match &lsquo;{trimmed}&rsquo;.</p>
      </section>
    );
  }
  return (
    <section className="bookshelf">
      <ul className="bookshelf__grid">
        {books.map((book) => (
          <li key={book.id} className="bookshelf__cell">
            <BookCard
              book={book}
              coverCache={coverCache}
              onRemove={onRemove}
              {...(onOpenBook && { onOpen: onOpenBook })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
