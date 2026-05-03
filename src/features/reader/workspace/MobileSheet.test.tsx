import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MobileSheet } from './MobileSheet';

afterEach(cleanup);

describe('MobileSheet', () => {
  it('renders sheet + scrim with role=dialog', () => {
    render(<MobileSheet onDismiss={() => undefined}>content</MobileSheet>);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.querySelector('.mobile-sheet__scrim')).not.toBeNull();
    expect(document.querySelector('.mobile-sheet__handle')).not.toBeNull();
    expect(screen.getByText('content')).toBeDefined();
  });

  it('fires onDismiss when scrim is clicked', () => {
    const onDismiss = vi.fn();
    render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    fireEvent.click(document.querySelector('.mobile-sheet__scrim')!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('fires onDismiss on Escape key', () => {
    const onDismiss = vi.fn();
    render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not fire onDismiss on other keys', () => {
    const onDismiss = vi.fn();
    render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('removes Escape listener on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
