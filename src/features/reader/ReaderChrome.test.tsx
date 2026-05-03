import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ReaderChrome } from './ReaderChrome';

afterEach(cleanup);

const baseProps = {
  title: 'Pride and Prejudice',
  onBack: () => undefined,
  onOpenToc: () => undefined,
  onOpenTypography: () => undefined,
  onToggleFocus: () => undefined,
  onAddBookmark: () => undefined,
};

describe('ReaderChrome', () => {
  it('shows back, title, and settings always', () => {
    render(<ReaderChrome {...baseProps} />);
    expect(screen.getByLabelText('Back to library')).toBeDefined();
    expect(screen.getByText('Pride and Prejudice')).toBeDefined();
    expect(screen.getByLabelText('Reader preferences')).toBeDefined();
  });

  it('shows TOC button when showTocButton is true', () => {
    render(<ReaderChrome {...baseProps} showTocButton />);
    expect(screen.getByLabelText('Table of contents')).toBeDefined();
  });

  it('hides TOC button when showTocButton is false', () => {
    render(<ReaderChrome {...baseProps} showTocButton={false} />);
    expect(screen.queryByLabelText('Table of contents')).toBeNull();
  });

  it('shows focus toggle when showFocusToggle is true and fires onToggleFocus', () => {
    const onToggleFocus = vi.fn();
    render(<ReaderChrome {...baseProps} showFocusToggle onToggleFocus={onToggleFocus} />);
    const btn = screen.getByLabelText('Toggle focus mode');
    fireEvent.click(btn);
    expect(onToggleFocus).toHaveBeenCalledOnce();
  });

  it('hides focus toggle when showFocusToggle is false', () => {
    render(<ReaderChrome {...baseProps} showFocusToggle={false} />);
    expect(screen.queryByLabelText('Toggle focus mode')).toBeNull();
  });
});

describe('ReaderChrome bookmark button', () => {
  it('renders ★ on both viewports and calls onAddBookmark', () => {
    const onAddBookmark = vi.fn();
    render(<ReaderChrome {...baseProps} onAddBookmark={onAddBookmark} />);
    fireEvent.click(screen.getByLabelText(/add bookmark/i));
    expect(onAddBookmark).toHaveBeenCalledOnce();
  });

  it('applies pulse class for ~250ms after a click', () => {
    vi.useFakeTimers();
    try {
      const onAddBookmark = vi.fn();
      render(<ReaderChrome {...baseProps} onAddBookmark={onAddBookmark} />);
      const btn = screen.getByLabelText(/add bookmark/i);
      fireEvent.click(btn);
      expect(btn.className).toMatch(/--pulse/);
      act(() => {
        vi.advanceTimersByTime(260);
      });
      expect(btn.className).not.toMatch(/--pulse/);
    } finally {
      vi.useRealTimers();
    }
  });
});
