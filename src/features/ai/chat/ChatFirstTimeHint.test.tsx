import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatFirstTimeHint } from './ChatFirstTimeHint';

afterEach(cleanup);

describe('ChatFirstTimeHint', () => {
  it('renders when visible', () => {
    render(<ChatFirstTimeHint visible onDismiss={() => undefined} />);
    expect(screen.getByText(/4\.4/)).toBeDefined();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(
      <ChatFirstTimeHint visible={false} onDismiss={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('dismiss calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<ChatFirstTimeHint visible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss hint'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
