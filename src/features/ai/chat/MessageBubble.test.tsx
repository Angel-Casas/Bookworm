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

describe('MessageBubble — source footer (Phase 4.4)', () => {
  const passageAnchor = { kind: 'epub-cfi' as const, cfi: 'epubcfi(/6/4!/4/2)' };
  const passageRef = {
    kind: 'passage' as const,
    text: 'she scarcely heard the rest, she was so taken aback',
    anchor: passageAnchor,
    sectionTitle: 'Chapter 4',
  };

  it('renders the source footer when assistant has a passage ref AND onJumpToSource is defined', () => {
    render(
      <MessageBubble
        message={mk({ contextRefs: [passageRef] })}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /jump to passage from chapter 4/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/she scarcely heard/i)).toBeInTheDocument();
  });

  // Locks the .find() pattern from spec §8.5 — when Phase 5+ multi-source mode
  // mixes ref kinds in the same array, this stays correct.
  it('uses .find() — renders the footer even when passage is not the first contextRef', () => {
    const otherRef = { kind: 'highlight' as const, highlightId: 'h1' as never };
    render(
      <MessageBubble
        message={mk({ contextRefs: [otherRef, passageRef] })}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /jump to passage/i }),
    ).toBeInTheDocument();
  });

  it('does not render the footer when contextRefs is empty (open-mode message)', () => {
    render(
      <MessageBubble
        message={mk({ contextRefs: [] })}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /jump to passage/i })).toBeNull();
  });

  it('does not render the footer when onJumpToSource is undefined', () => {
    render(<MessageBubble message={mk({ contextRefs: [passageRef] })} />);
    expect(screen.queryByRole('button', { name: /jump to/i })).toBeNull();
  });

  it('does not render the footer on user messages even with passage refs', () => {
    render(
      <MessageBubble
        message={mk({ role: 'user', contextRefs: [passageRef] })}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /jump to/i })).toBeNull();
  });

  it('clicking the footer calls onJumpToSource with the matched ref anchor', () => {
    const onJumpToSource = vi.fn();
    render(
      <MessageBubble
        message={mk({ contextRefs: [passageRef] })}
        onJumpToSource={onJumpToSource}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /jump to passage/i }));
    expect(onJumpToSource).toHaveBeenCalledWith(passageAnchor);
  });

  it('uses generic aria-label when sectionTitle is absent', () => {
    const refNoSection = {
      kind: 'passage' as const,
      text: 't',
      anchor: passageAnchor,
    };
    render(
      <MessageBubble
        message={mk({ contextRefs: [refNoSection] })}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /jump to source/i }),
    ).toBeInTheDocument();
  });
});
