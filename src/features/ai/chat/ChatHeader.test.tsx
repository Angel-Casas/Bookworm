import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatHeader } from './ChatHeader';
import type { ChatThread } from '@/domain';
import { BookId, ChatThreadId, IsoTimestamp } from '@/domain';

afterEach(cleanup);

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: ChatThreadId('t-1'),
    bookId: BookId('book-1'),
    title: 'A conversation',
    modelId: 'gpt-x',
    answerStyle: 'open',
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ChatHeader', () => {
  it('shows the active thread title', () => {
    const t = thread({ title: 'Active' });
    render(
      <ChatHeader
        threads={[t]}
        activeId={t.id}
        onSelectThread={() => undefined}
        onRenameThread={() => undefined}
        onDeleteThread={() => undefined}
        onStartDraft={() => undefined}
        onCollapse={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { expanded: false })).toBeDefined();
    expect(screen.getByText(/Active/)).toBeDefined();
  });

  it('opens the thread list when title clicked', () => {
    const t = thread();
    render(
      <ChatHeader
        threads={[t]}
        activeId={t.id}
        onSelectThread={() => undefined}
        onRenameThread={() => undefined}
        onDeleteThread={() => undefined}
        onStartDraft={() => undefined}
        onCollapse={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('listbox')).toBeDefined();
  });

  it('calls onStartDraft', () => {
    const onStartDraft = vi.fn();
    render(
      <ChatHeader
        threads={[]}
        activeId={null}
        onSelectThread={() => undefined}
        onRenameThread={() => undefined}
        onDeleteThread={() => undefined}
        onStartDraft={onStartDraft}
        onCollapse={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText('New conversation'));
    expect(onStartDraft).toHaveBeenCalled();
  });

  it('calls onCollapse', () => {
    const onCollapse = vi.fn();
    render(
      <ChatHeader
        threads={[]}
        activeId={null}
        onSelectThread={() => undefined}
        onRenameThread={() => undefined}
        onDeleteThread={() => undefined}
        onStartDraft={() => undefined}
        onCollapse={onCollapse}
      />,
    );
    fireEvent.click(screen.getByLabelText('Collapse chat panel'));
    expect(onCollapse).toHaveBeenCalled();
  });
});
