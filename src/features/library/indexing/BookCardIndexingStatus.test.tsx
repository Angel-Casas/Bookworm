import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BookCardIndexingStatus } from './BookCardIndexingStatus';
import type { Book } from '@/domain';
import { BookId, IsoTimestamp } from '@/domain';

afterEach(cleanup);

function makeBook(status: Book['indexingStatus']): Book {
  return {
    id: BookId('b1'),
    title: 'X',
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'x',
      checksum: 'x',
    },
    importStatus: { kind: 'ready' },
    indexingStatus: status,
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

describe('BookCardIndexingStatus', () => {
  it('pending: shows queued text, no inspector link', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'pending' })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/queued for indexing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /index inspector/i })).toBeNull();
  });

  it('chunking: shows progress bar and percent', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'chunking', progressPercent: 45 })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/45%/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('ready: clicking the inspector link calls onOpenInspector', () => {
    const onOpenInspector = vi.fn();
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'ready' })}
        onOpenInspector={onOpenInspector}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open index inspector/i }));
    expect(onOpenInspector).toHaveBeenCalledOnce();
  });

  it('failed (generic): shows headline and Retry button', () => {
    const onRetry = vi.fn();
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'failed', reason: 'extract-failed' })}
        onOpenInspector={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/couldn't index/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('failed (embedding-no-key): shows actionable headline and Open Settings button', () => {
    const onOpenSettings = vi.fn();
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'failed', reason: 'embedding-no-key' })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(screen.getByText(/api key required/i)).toBeInTheDocument();
    const settingsBtn = screen.getByRole('button', { name: /open settings/i });
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    // The hint surfaces the actionable next step for screen readers.
    expect(screen.getByText(/add or unlock your key in settings/i)).toBeInTheDocument();
  });

  it('failed (embedding-no-key) without onOpenSettings: hides settings button gracefully', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'failed', reason: 'embedding-no-key' })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/api key required/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open settings/i })).toBeNull();
    // Retry is always present.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('failed (embedding-insufficient-balance): shows top-up headline + hint', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'failed', reason: 'embedding-insufficient-balance' })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/top up your account/i)).toBeInTheDocument();
    expect(screen.getByText(/add credit at nano-gpt\.com/i)).toBeInTheDocument();
  });

  it('failed (embedding-rate-limited): shows rate-limited headline + hint', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'failed', reason: 'embedding-rate-limited' })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/rate limited/i)).toBeInTheDocument();
    expect(screen.getByText(/wait a moment, then click retry/i)).toBeInTheDocument();
  });

  it('embedding: shows forward-compat "Preparing for AI" label', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'embedding', progressPercent: 30 })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/preparing for ai/i)).toBeInTheDocument();
  });
});
