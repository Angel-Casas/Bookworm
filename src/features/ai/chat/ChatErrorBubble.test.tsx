import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatErrorBubble } from './ChatErrorBubble';

afterEach(cleanup);

describe('ChatErrorBubble', () => {
  it('invalid-key: renders Open Settings action', () => {
    const onOpenSettings = vi.fn();
    render(
      <ChatErrorBubble
        failure={{ reason: 'invalid-key', status: 401 }}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(screen.getByText(/api key was rejected/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('rate-limit: renders Retry action', () => {
    const onRetry = vi.fn();
    render(<ChatErrorBubble failure={{ reason: 'rate-limit', status: 429 }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('model-unavailable: renders Switch Model action', () => {
    const onSwitchModel = vi.fn();
    render(
      <ChatErrorBubble
        failure={{ reason: 'model-unavailable', status: 404 }}
        onSwitchModel={onSwitchModel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /switch model/i }));
    expect(onSwitchModel).toHaveBeenCalled();
  });

  it('server: renders both Retry and Switch Model', () => {
    render(
      <ChatErrorBubble
        failure={{ reason: 'server', status: 500 }}
        onRetry={() => undefined}
        onSwitchModel={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /switch model/i })).toBeDefined();
  });

  it('network: renders Retry action', () => {
    const onRetry = vi.fn();
    render(<ChatErrorBubble failure={{ reason: 'network' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('malformed-stream: renders Retry action', () => {
    const onRetry = vi.fn();
    render(<ChatErrorBubble failure={{ reason: 'malformed-stream' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Dismiss button calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <ChatErrorBubble failure={{ reason: 'network' }} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
