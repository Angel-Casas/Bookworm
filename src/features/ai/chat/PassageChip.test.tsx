import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PassageChip } from './PassageChip';

afterEach(cleanup);

describe('PassageChip', () => {
  it('renders the truncated selection text', () => {
    render(
      <PassageChip
        text="She scarcely heard the rest, she was so taken aback"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/she scarcely heard the rest/i)).toBeInTheDocument();
  });

  it('renders section title above the selection text when provided', () => {
    render(
      <PassageChip
        text="t"
        sectionTitle="Chapter 4"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Chapter 4')).toBeInTheDocument();
  });

  it('omits section line when sectionTitle is undefined', () => {
    render(<PassageChip text="just text" onDismiss={vi.fn()} />);
    expect(screen.queryByText(/chapter/i)).toBeNull();
  });

  it('truncates display text longer than 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    render(<PassageChip text={long} onDismiss={vi.fn()} />);
    const node = screen.getByText(/x.*…/);
    const content = node.textContent;
    expect(content.length).toBeLessThan(120);
    expect(content).toContain('…');
  });

  it('keeps short text intact (no ellipsis)', () => {
    render(<PassageChip text="short" onDismiss={vi.fn()} />);
    expect(screen.getByText('short')).toBeInTheDocument();
    expect(screen.queryByText(/…/)).toBeNull();
  });

  it('exposes role=status with aria-live=polite', () => {
    render(<PassageChip text="t" onDismiss={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('aria-label includes the FULL selection (not truncated) and the section', () => {
    const long = 'a'.repeat(120);
    render(
      <PassageChip text={long} sectionTitle="Chapter 1" onDismiss={vi.fn()} />,
    );
    const status = screen.getByRole('status');
    const label = status.getAttribute('aria-label');
    expect(label).toContain('Chapter 1');
    expect(label).toContain(long); // full, not truncated
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<PassageChip text="t" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss attached passage/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
