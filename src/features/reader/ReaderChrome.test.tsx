import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReaderChrome } from './ReaderChrome';

afterEach(cleanup);

const baseProps = {
  title: 'Pride and Prejudice',
  onBack: () => undefined,
  onOpenToc: () => undefined,
  onOpenTypography: () => undefined,
  onToggleFocus: () => undefined,
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
