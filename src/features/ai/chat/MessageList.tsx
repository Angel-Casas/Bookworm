import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatMessageId } from '@/domain';
import type { HighlightAnchor } from '@/domain/annotations/types';
import { MessageBubble } from './MessageBubble';
import { ChatErrorBubble } from './ChatErrorBubble';
import type { ChatCompletionFailure } from './nanogptChat';

const STICK_THRESHOLD_PX = 80;

type Props = {
  readonly messages: readonly ChatMessage[];
  readonly failure?: ChatCompletionFailure | null;
  readonly onSaveMessage?: (id: ChatMessageId) => void;
  readonly onRetry?: () => void;
  readonly onSwitchModel?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onDismissError?: () => void;
  // Phase 4.4: passes through to MessageBubble's source footer.
  readonly onJumpToSource?: (anchor: HighlightAnchor) => void;
};

export function MessageList({
  messages,
  failure,
  onSaveMessage,
  onRetry,
  onSwitchModel,
  onOpenSettings,
  onDismissError,
  onJumpToSource,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState<boolean>(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stickToBottom) el.scrollTop = el.scrollHeight;
  }, [messages, failure, stickToBottom]);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    setStickToBottom(fromBottom <= STICK_THRESHOLD_PX);
  };

  return (
    <div
      ref={ref}
      className="message-list"
      role="log"
      aria-live="polite"
      onScroll={onScroll}
    >
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          {...(onSaveMessage ? { onSave: onSaveMessage } : {})}
          {...(onJumpToSource ? { onJumpToSource } : {})}
        />
      ))}
      {failure ? (
        <ChatErrorBubble
          failure={failure}
          {...(onRetry ? { onRetry } : {})}
          {...(onSwitchModel ? { onSwitchModel } : {})}
          {...(onOpenSettings ? { onOpenSettings } : {})}
          {...(onDismissError ? { onDismiss: onDismissError } : {})}
        />
      ) : null}
    </div>
  );
}
