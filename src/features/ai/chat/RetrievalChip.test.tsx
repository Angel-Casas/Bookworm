import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { RetrievalChip } from './RetrievalChip';

afterEach(() => {
  cleanup();
});

describe('RetrievalChip', () => {
  it('renders the searching label', () => {
    const { container } = render(<RetrievalChip onDismiss={() => undefined} />);
    expect(container.textContent).toMatch(/searching this book/i);
  });

  it('exposes role=status with aria-live=polite', () => {
    const { container } = render(<RetrievalChip onDismiss={() => undefined} />);
    const chip = container.querySelector('.retrieval-chip');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('role')).toBe('status');
    expect(chip?.getAttribute('aria-live')).toBe('polite');
  });

  it('calls onDismiss when the × button is clicked', () => {
    const onDismiss = vi.fn();
    const { container } = render(<RetrievalChip onDismiss={onDismiss} />);
    const btn = container.querySelector('.retrieval-chip__dismiss');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
