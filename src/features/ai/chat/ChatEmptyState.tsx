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
  return (
    <div className="chat-empty">
      <p className="chat-empty__lead">
        Ask anything about <em>{props.bookTitle}</em>.
      </p>
      <button type="button" className="chat-empty__action" onClick={props.onStartDraft}>
        Start a conversation
      </button>
    </div>
  );
}
