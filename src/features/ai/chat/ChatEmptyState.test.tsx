import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatEmptyState } from './ChatEmptyState';

afterEach(cleanup);

describe('ChatEmptyState', () => {
  it('no-key variant invites the user to settings', () => {
    const onOpenSettings = vi.fn();
    render(
      <ChatEmptyState variant="no-key" onOpenSettings={onOpenSettings} bookTitle="Moby-Dick" />,
    );
    expect(screen.getByText(/api key/i)).toBeDefined();
    expect(screen.getByText('Moby-Dick')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('no-model variant invites the user to choose a model', () => {
    const onOpenSettings = vi.fn();
    render(
      <ChatEmptyState variant="no-model" onOpenSettings={onOpenSettings} bookTitle="X" />,
    );
    expect(screen.getByText(/choose a model/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('no-threads variant invites the user to start a conversation', () => {
    const onStartDraft = vi.fn();
    render(
      <ChatEmptyState
        variant="no-threads"
        onStartDraft={onStartDraft}
        bookTitle="Moby-Dick"
      />,
    );
    expect(screen.getByText('Moby-Dick')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    expect(onStartDraft).toHaveBeenCalled();
  });
});
