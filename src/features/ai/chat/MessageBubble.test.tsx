import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';

afterEach(cleanup);

function mk(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ChatMessageId('m'),
    threadId: ChatThreadId('t'),
    role: 'assistant',
    content: 'hello',
    contextRefs: [],
    createdAt: IsoTimestamp(new Date().toISOString()),
    ...overrides,
  };
}

describe('MessageBubble', () => {
  it('renders user message right-aligned with no Save button', () => {
    const { container } = render(
      <MessageBubble message={mk({ role: 'user', content: 'hi' })} />,
    );
    expect(container.querySelector('.message-bubble--user')).not.toBeNull();
    expect(screen.queryByLabelText('Save answer')).toBeNull();
  });

  it('renders assistant with AI badge and Save button', () => {
    const onSave = vi.fn();
    render(<MessageBubble message={mk()} onSave={onSave} />);
    expect(screen.getByLabelText('AI generated')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Save answer'));
    expect(onSave).toHaveBeenCalledWith(ChatMessageId('m'));
  });

  it('shows streaming caret and hides Save while streaming', () => {
    const { container } = render(
      <MessageBubble message={mk({ streaming: true })} onSave={() => undefined} />,
    );
    expect(container.querySelector('.message-bubble__caret')).not.toBeNull();
    expect(screen.queryByLabelText('Save answer')).toBeNull();
  });

  it('shows (stopped) when truncated and keeps Save enabled', () => {
    render(<MessageBubble message={mk({ truncated: true })} onSave={() => undefined} />);
    expect(screen.getByText('(stopped)')).toBeDefined();
    expect(screen.getByLabelText('Save answer')).toBeDefined();
  });
});
