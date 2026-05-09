import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NotebookChrome } from './NotebookChrome';

afterEach(cleanup);

describe('NotebookChrome', () => {
  it('renders the back button + title with book name', () => {
    render(
      <NotebookChrome
        bookTitle="Pride and Prejudice"
        onBack={() => undefined}
        onExport={() => undefined}
        canExport={true}
      />,
    );
    expect(screen.getByRole('button', { name: /back to reader/i })).toBeInTheDocument();
    expect(screen.getByText(/Notebook/)).toBeInTheDocument();
    expect(screen.getByText(/Pride and Prejudice/)).toBeInTheDocument();
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    render(
      <NotebookChrome
        bookTitle="x"
        onBack={onBack}
        onExport={() => undefined}
        canExport={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back to reader/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders the Export button enabled when canExport is true', () => {
    render(
      <NotebookChrome
        bookTitle="Test"
        onBack={() => undefined}
        onExport={() => undefined}
        canExport={true}
      />,
    );
    const btn = screen.getByRole('button', { name: /export notebook/i });
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the Export button when canExport is false', () => {
    render(
      <NotebookChrome
        bookTitle="Test"
        onBack={() => undefined}
        onExport={() => undefined}
        canExport={false}
      />,
    );
    const btn = screen.getByRole('button', { name: /export notebook/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/no entries/i);
  });

  it('invokes onExport when the button is clicked', () => {
    const onExport = vi.fn();
    render(
      <NotebookChrome
        bookTitle="Test"
        onBack={() => undefined}
        onExport={onExport}
        canExport={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export notebook/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
