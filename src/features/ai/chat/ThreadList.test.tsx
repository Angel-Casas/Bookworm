import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadList } from './ThreadList';
import type { ChatThread } from '@/domain';
import { BookId, ChatThreadId, IsoTimestamp } from '@/domain';

afterEach(cleanup);

function thread(id: string, title: string): ChatThread {
  return {
    id: ChatThreadId(id),
    bookId: BookId('book-1'),
    title,
    modelId: 'gpt-x',
    answerStyle: 'open',
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
  };
}

describe('ThreadList', () => {
  it('renders rows for each thread', () => {
    render(
      <ThreadList
        threads={[thread('t-1', 'First'), thread('t-2', 'Second')]}
        activeId={ChatThreadId('t-1')}
        onSelect={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });

  it('shows empty state when threads list is empty', () => {
    render(
      <ThreadList
        threads={[]}
        activeId={null}
        onSelect={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/no conversations yet/i)).toBeDefined();
  });

  it('click on row calls onSelect', () => {
    const onSelect = vi.fn();
    render(
      <ThreadList
        threads={[thread('t-1', 'First')]}
        activeId={null}
        onSelect={onSelect}
        onRename={() => undefined}
        onDelete={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText('First'));
    expect(onSelect).toHaveBeenCalledWith(ChatThreadId('t-1'));
  });

  it('delete button calls onDelete and stops propagation', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <ThreadList
        threads={[thread('t-1', 'First')]}
        activeId={null}
        onSelect={onSelect}
        onRename={() => undefined}
        onDelete={onDelete}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText('Delete conversation First'));
    expect(onDelete).toHaveBeenCalledWith(ChatThreadId('t-1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(
      <ThreadList
        threads={[thread('t-1', 'First')]}
        activeId={null}
        onSelect={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
