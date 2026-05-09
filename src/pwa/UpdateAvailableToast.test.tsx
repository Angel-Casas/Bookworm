import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { UpdateAvailableToast } from './UpdateAvailableToast';
import { swUpdateStore } from './swUpdateStore';

beforeEach(() => {
  swUpdateStore.setState({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
  });
});
afterEach(cleanup);

describe('UpdateAvailableToast', () => {
  it('renders nothing when needsRefresh is false', () => {
    const { container } = render(<UpdateAvailableToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title, body, Refresh, and Dismiss when needsRefresh is true', () => {
    swUpdateStore.setState({ needsRefresh: true });
    render(<UpdateAvailableToast />);
    expect(screen.getByText('An update is available.')).toBeDefined();
    expect(screen.getByText('Reload to get the latest Bookworm.')).toBeDefined();
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Dismiss$/i })).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('Refresh click invokes applyUpdate', () => {
    const applyUpdate = vi.fn(() => Promise.resolve());
    swUpdateStore.setState({ needsRefresh: true, applyUpdate });
    render(<UpdateAvailableToast />);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/i }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('Dismiss click invokes dismissNeedsRefresh', () => {
    swUpdateStore.setState({ needsRefresh: true });
    render(<UpdateAvailableToast />);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }));
    expect(swUpdateStore.getState().needsRefresh).toBe(false);
  });
});
