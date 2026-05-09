import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';

afterEach(cleanup);

function Throw({ message }: { message: string }): never {
  throw new Error(message);
}

describe('AppErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <AppErrorBoundary>
        <p>hello</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeDefined();
  });

  it('catches a render-time throw and renders the fallback', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Throw message="boom" />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong.')).toBeDefined();
    expect(screen.getByRole('button', { name: /reload bookworm/i })).toBeDefined();
    errSpy.mockRestore();
  });

  it('keeps error.message hidden by default but reveals on details expand', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Throw message="boom message" />
      </AppErrorBoundary>,
    );
    const summary = screen.getByText(/show details/i);
    expect(summary).toBeDefined();
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByText(/boom message/i)).toBeDefined();
    errSpy.mockRestore();
  });

  it('reload button calls window.location.reload', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reloadMock = vi.fn();
    const originalReload = window.location.reload;
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reloadMock,
    });
    try {
      render(
        <AppErrorBoundary>
          <Throw message="boom" />
        </AppErrorBoundary>,
      );
      fireEvent.click(screen.getByRole('button', { name: /reload bookworm/i }));
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.location, 'reload', {
        configurable: true,
        value: originalReload,
      });
      errSpy.mockRestore();
    }
  });
});
