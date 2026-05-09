import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OfflineReadyToast } from './OfflineReadyToast';
import { swUpdateStore } from './swUpdateStore';

beforeEach(() => {
  localStorage.clear();
  swUpdateStore.setState({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('OfflineReadyToast', () => {
  it('renders nothing when offlineReady is false', () => {
    const { container } = render(<OfflineReadyToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title with role="status" when offlineReady is true', () => {
    swUpdateStore.setState({ offlineReady: true });
    render(<OfflineReadyToast />);
    expect(screen.getByText('Bookworm is ready offline.')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('Dismiss click invokes dismissOfflineReady immediately', () => {
    swUpdateStore.setState({ offlineReady: true });
    render(<OfflineReadyToast />);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }));
    expect(swUpdateStore.getState().offlineReady).toBe(false);
    expect(localStorage.getItem('bookworm.offlineReadySeen')).toBe('1');
  });

  it('auto-dismisses after 8 seconds', () => {
    swUpdateStore.setState({ offlineReady: true });
    render(<OfflineReadyToast />);
    expect(swUpdateStore.getState().offlineReady).toBe(true);
    vi.advanceTimersByTime(8000);
    expect(swUpdateStore.getState().offlineReady).toBe(false);
    expect(localStorage.getItem('bookworm.offlineReadySeen')).toBe('1');
  });

  it('clears the auto-dismiss timer on unmount', () => {
    swUpdateStore.setState({ offlineReady: true });
    const { unmount } = render(<OfflineReadyToast />);
    unmount();
    swUpdateStore.setState({ offlineReady: true });
    vi.advanceTimersByTime(10_000);
    expect(swUpdateStore.getState().offlineReady).toBe(true);
  });
});
