import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NotebookChrome } from './NotebookChrome';

afterEach(cleanup);

describe('NotebookChrome', () => {
  it('renders the back button + title with book name', () => {
    render(<NotebookChrome bookTitle="Pride and Prejudice" onBack={() => undefined} />);
    expect(screen.getByRole('button', { name: /back to reader/i })).toBeInTheDocument();
    expect(screen.getByText(/Notebook/)).toBeInTheDocument();
    expect(screen.getByText(/Pride and Prejudice/)).toBeInTheDocument();
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    render(<NotebookChrome bookTitle="x" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /back to reader/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
