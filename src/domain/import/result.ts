import type { Book } from '../book/types';
import type { BookId } from '../ids';

export type ImportResult =
  | { readonly kind: 'success'; readonly book: Book }
  | { readonly kind: 'duplicate'; readonly existingBookId: BookId }
  | { readonly kind: 'failure'; readonly reason: string; readonly fileName: string };
