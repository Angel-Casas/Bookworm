import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotebookEmptyState } from './NotebookEmptyState';

afterEach(cleanup);

describe('NotebookEmptyState', () => {
  it("reason='no-entries' renders welcome copy", () => {
    render(<NotebookEmptyState reason="no-entries" />);
    expect(screen.getByText(/no annotations yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Open this book and tap/i)).toBeInTheDocument();
  });

  it("reason='no-matches' renders no-matches copy", () => {
    render(<NotebookEmptyState reason="no-matches" />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    expect(screen.getByText(/Try a different search/i)).toBeInTheDocument();
  });
});
