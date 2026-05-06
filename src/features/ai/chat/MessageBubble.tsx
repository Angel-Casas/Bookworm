import type { ChatMessage, ChatMessageId } from '@/domain';
import type { HighlightAnchor } from '@/domain/annotations/types';
import { SaveAnswerIcon } from '@/shared/icons';
import './message-bubble.css';

type Props = {
  readonly message: ChatMessage;
  readonly onSave?: (id: ChatMessageId) => void;
  // Phase 4.4: when defined, renders an inline source footer on assistant
  // messages whose contextRefs include a passage. .find()-based detection so
  // multi-source modes in Phase 5+ continue to work without changes here.
  readonly onJumpToSource?: (anchor: HighlightAnchor) => void;
};

const SOURCE_SNIPPET_CAP = 40;

function snippetForFooter(text: string): string {
  if (text.length <= SOURCE_SNIPPET_CAP) return text;
  return text.slice(0, SOURCE_SNIPPET_CAP).trimEnd() + '…';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function MessageBubble({ message, onSave, onJumpToSource }: Props) {
  if (message.role === 'user') {
    return (
      <div className="message-bubble message-bubble--user" role="article">
        <p className="message-bubble__content">{message.content}</p>
      </div>
    );
  }
  const isStreaming = message.streaming === true;
  const isTruncated = message.truncated === true;
  const passageRef =
    onJumpToSource !== undefined
      ? message.contextRefs.find((r) => r.kind === 'passage')
      : undefined;
  return (
    <div
      className="message-bubble message-bubble--assistant"
      role="article"
      aria-busy={isStreaming || undefined}
    >
      <p className="message-bubble__content">
        {message.content}
        {isStreaming ? <span className="message-bubble__caret" aria-hidden="true" /> : null}
      </p>
      <div className="message-bubble__footer">
        {isTruncated ? <em className="message-bubble__truncated">(stopped)</em> : null}
        <span className="message-bubble__badge" aria-label="AI generated">AI</span>
        <span className="message-bubble__time">{relativeTime(message.createdAt)}</span>
        {passageRef !== undefined && onJumpToSource !== undefined ? (
          <button
            type="button"
            className="message-bubble__source-footer"
            aria-label={
              passageRef.sectionTitle !== undefined
                ? `Jump to passage from ${passageRef.sectionTitle}`
                : 'Jump to source'
            }
            onClick={() => {
              onJumpToSource(passageRef.anchor);
            }}
          >
            <span aria-hidden="true">📎</span>
            <span>Source: &ldquo;{snippetForFooter(passageRef.text)}&rdquo;</span>
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        {!isStreaming && onSave ? (
          <button
            type="button"
            className="message-bubble__save"
            aria-label="Save answer"
            onClick={() => {
              onSave(message.id);
            }}
          >
            <SaveAnswerIcon size={14} />
            <span>Save</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
