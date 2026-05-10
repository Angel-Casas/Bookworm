import type { UseBookProfileHandle } from '@/features/ai/prompts';
import { SuggestedPromptList } from '@/features/ai/prompts';

type Props =
  | {
      readonly variant: 'no-key';
      readonly bookTitle: string;
      readonly onOpenSettings: () => void;
    }
  | {
      readonly variant: 'no-model';
      readonly bookTitle: string;
      readonly onOpenSettings: () => void;
    }
  | {
      readonly variant: 'no-threads';
      readonly bookTitle: string;
      readonly onStartDraft: () => void;
      // Phase 5.3: when defined, render prompts/states instead of (or in
      // addition to) the generic CTA. When omitted, the original empty
      // state renders unchanged.
      readonly promptsState?: UseBookProfileHandle;
      readonly onSelectPrompt?: (text: string) => void;
      readonly onEditPrompt?: (text: string) => void;
    };

export function ChatEmptyState(props: Props) {
  if (props.variant === 'no-key') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Set up your API key to start chatting about <em>{props.bookTitle}</em>.
        </p>
        <button type="button" className="chat-empty__action" onClick={props.onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }
  if (props.variant === 'no-model') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Choose a model in Settings to start chatting about <em>{props.bookTitle}</em>.
        </p>
        <button type="button" className="chat-empty__action" onClick={props.onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }

  // variant === 'no-threads' — Phase 5.3 extension begins here
  const ps = props.promptsState;
  const onSelect = props.onSelectPrompt;
  const onEdit = props.onEditPrompt;
  const promptsWired = ps !== undefined && onSelect !== undefined && onEdit !== undefined;

  if (promptsWired && ps.status === 'loading') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Generating suggestions for <em>{props.bookTitle}</em>…
        </p>
        <div
          className="suggested-prompts__loading motion-fade-in"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <span>Reading your book…</span>
        </div>
      </div>
    );
  }

  if (promptsWired && ps.status === 'ready') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Suggestions for <em>{props.bookTitle}</em>:
        </p>
        <SuggestedPromptList
          prompts={ps.record.prompts}
          onSelect={onSelect}
          onEdit={onEdit}
        />
        <button
          type="button"
          className="chat-empty__action chat-empty__action--secondary"
          onClick={props.onStartDraft}
        >
          or, start a blank conversation
        </button>
      </div>
    );
  }

  // 'failed' / 'no-chunks' / 'idle' / not-wired all fall through to the
  // original button + an optional info chip below.
  const chip = !promptsWired
    ? null
    : ps.status === 'failed'
      ? (
          <button
            type="button"
            className="suggested-prompts__retry-chip"
            aria-label="Retry suggestions"
            onClick={ps.retry}
          >
            Couldn&rsquo;t load suggestions. Retry
          </button>
        )
      : ps.status === 'no-chunks'
        ? (
            <span className="suggested-prompts__retry-chip" role="status">
              This book is still being prepared for AI…
            </span>
          )
        : null;

  return (
    <div className="chat-empty">
      <p className="chat-empty__lead">
        Ask anything about <em>{props.bookTitle}</em>.
      </p>
      <button type="button" className="chat-empty__action" onClick={props.onStartDraft}>
        Start a conversation
      </button>
      {chip}
    </div>
  );
}
