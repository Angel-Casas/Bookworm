import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BookmarksPanel } from './BookmarksPanel';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';

afterEach(cleanup);

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function bm(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: BookmarkId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
    snippet: 'A short bookmarked passage of text.',
    sectionTitle: 'Chapter 1',
    createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    ...overrides,
  };
}

describe('BookmarksPanel', () => {
  it('renders rows with section title, relative time, and snippet', () => {
    render(
      <BookmarksPanel
        bookmarks={[bm({ sectionTitle: 'Chapter 1', snippet: 'Hello world' })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('Hello world')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
  });

  it('shows empty state when no bookmarks', () => {
    render(
      <BookmarksPanel bookmarks={[]} onSelect={() => undefined} onDelete={() => undefined} />,
    );
    expect(screen.getByText(/No bookmarks yet/i)).toBeDefined();
  });

  it('hides the snippet line when snippet is null', () => {
    const { container } = render(
      <BookmarksPanel
        bookmarks={[bm({ snippet: null })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(container.querySelector('.bookmarks-panel__snippet')).toBeNull();
  });

  it('renders "—" when sectionTitle is null', () => {
    render(
      <BookmarksPanel
        bookmarks={[bm({ sectionTitle: null })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('—')).toBeDefined();
  });

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn();
    const target = bm();
    render(
      <BookmarksPanel
        bookmarks={[target]}
        onSelect={onSelect}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chapter 1/i }));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('calls onDelete when [×] is clicked, not onSelect', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const target = bm();
    render(
      <BookmarksPanel
        bookmarks={[target]}
        onSelect={onSelect}
        onDelete={onDelete}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove bookmark/i));
    expect(onDelete).toHaveBeenCalledWith(target);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders bookmarks in the order provided (caller sorts)', () => {
    const a = bm({ sectionTitle: 'Alpha' });
    const b = bm({ sectionTitle: 'Beta' });
    const c = bm({ sectionTitle: 'Gamma' });
    render(
      <BookmarksPanel
        bookmarks={[c, a, b]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    const titles = Array.from(document.querySelectorAll('.bookmarks-panel__section')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  describe('error variant', () => {
    it('renders aside with role="alert" + Retry button when loadError is set', () => {
      const onRetry = vi.fn();
      render(
        <BookmarksPanel
          bookmarks={[]}
          onSelect={() => undefined}
          onDelete={() => undefined}
          loadError={new Error('boom')}
          onRetryLoad={onRetry}
        />,
      );
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/couldn['’]t load bookmarks/i)).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('error variant takes precedence over the empty state', () => {
      render(
        <BookmarksPanel
          bookmarks={[]}
          onSelect={() => undefined}
          onDelete={() => undefined}
          loadError={new Error('boom')}
          onRetryLoad={() => undefined}
        />,
      );
      expect(screen.queryByText(/no bookmarks yet/i)).toBeNull();
    });
  });
});
