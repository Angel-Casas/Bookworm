import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NotebookSearchBar } from './NotebookSearchBar';

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers();
});

describe('NotebookSearchBar', () => {
  it('renders search input + 4 filter chips', () => {
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="all"
        onFilterChange={() => undefined}
      />,
    );
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bookmarks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^highlights$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^notes$/i })).toBeInTheDocument();
  });

  it('debounces onQueryChange ~150ms', () => {
    const onQueryChange = vi.fn();
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={onQueryChange}
        filter="all"
        onFilterChange={() => undefined}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } });
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(onQueryChange).toHaveBeenCalledWith('a');
  });

  it('filter chip click is immediate (no debounce)', () => {
    const onFilterChange = vi.fn();
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="all"
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /bookmarks/i }));
    expect(onFilterChange).toHaveBeenCalledWith('bookmarks');
  });

  it('aria-pressed reflects active filter', () => {
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="highlights"
        onFilterChange={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /^highlights$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('Cmd/Ctrl+K focuses the search input', () => {
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="all"
        onFilterChange={() => undefined}
      />,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });
});
