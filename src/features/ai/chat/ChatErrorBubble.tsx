import type { ChatCompletionFailure } from './nanogptChat';
import './message-bubble.css';

type Props = {
  readonly failure: ChatCompletionFailure;
  readonly onRetry?: () => void;
  readonly onSwitchModel?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onDismiss?: () => void;
};

function copyFor(failure: ChatCompletionFailure): string {
  switch (failure.reason) {
    case 'invalid-key':
      return 'Your API key was rejected. Update it in Settings.';
    case 'rate-limit':
      return 'Rate limited by NanoGPT. Try again in a moment.';
    case 'model-unavailable':
      return "The selected model isn't available. Choose another.";
    case 'network':
      return 'No connection.';
    case 'server':
      return `NanoGPT had an issue (status ${String(failure.status)}). Try again.`;
    case 'malformed-stream':
      return "The response stream couldn't be parsed. Try again.";
    case 'aborted':
      return 'Cancelled.';
  }
}

export function ChatErrorBubble({
  failure,
  onRetry,
  onSwitchModel,
  onOpenSettings,
  onDismiss,
}: Props) {
  return (
    <div className="message-bubble message-bubble--error" role="alert">
      <p className="message-bubble__content">{copyFor(failure)}</p>
      <div className="message-bubble__footer">
        {failure.reason === 'invalid-key' && onOpenSettings ? (
          <button type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        ) : null}
        {(failure.reason === 'rate-limit' ||
          failure.reason === 'network' ||
          failure.reason === 'server' ||
          failure.reason === 'malformed-stream') &&
        onRetry ? (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {(failure.reason === 'model-unavailable' || failure.reason === 'server') &&
        onSwitchModel ? (
          <button type="button" onClick={onSwitchModel}>
            Switch Model
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" aria-label="Dismiss" onClick={onDismiss}>
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
