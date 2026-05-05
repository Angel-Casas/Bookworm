import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';

afterEach(cleanup);

function mk(id: string, role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: ChatMessageId(id),
    threadId: ChatThreadId('t'),
    role,
    content,
    contextRefs: [],
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
  };
}

describe('MessageList', () => {
  it('renders messages in order', () => {
    render(
      <MessageList
        messages={[mk('m-1', 'user', 'first'), mk('m-2', 'assistant', 'second')]}
      />,
    );
    expect(screen.getByText('first')).toBeDefined();
    expect(screen.getByText('second')).toBeDefined();
  });

  it('renders an error bubble when failure is provided', () => {
    render(
      <MessageList
        messages={[]}
        failure={{ reason: 'network' }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(/no connection/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });

  it('exposes role=log and aria-live=polite', () => {
    const { container } = render(<MessageList messages={[]} />);
    const log = container.querySelector('[role="log"]');
    expect(log).not.toBeNull();
    expect(log?.getAttribute('aria-live')).toBe('polite');
  });
});
