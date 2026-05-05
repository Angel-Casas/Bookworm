import { useEffect, useRef, useState } from 'react';
import { SendIcon, StopIcon } from '@/shared/icons';
import './chat-composer.css';

const MAX_LINES = 6;
const FALLBACK_LINE_HEIGHT_PX = 20;

type Props = {
  readonly disabled?: boolean;
  readonly streaming: boolean;
  readonly placeholder: string;
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
};

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // userAgent is the supported way; navigator.platform is deprecated.
  return /Mac/i.test(navigator.userAgent);
}

export function ChatComposer({ disabled, streaming, placeholder, onSend, onCancel }: Props) {
  const [text, setText] = useState<string>('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const computedLine = parseFloat(getComputedStyle(ta).lineHeight);
    const lineHeight = Number.isFinite(computedLine) ? computedLine : FALLBACK_LINE_HEIGHT_PX;
    const maxH = lineHeight * MAX_LINES;
    ta.style.height = `${String(Math.min(ta.scrollHeight, maxH))}px`;
  }, [text]);

  const sendNow = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!streaming) sendNow();
      }}
    >
      <textarea
        ref={taRef}
        className="chat-composer__textarea"
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        disabled={disabled === true || streaming}
        onChange={(e) => {
          setText(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          const modifier = isMac() ? e.metaKey : e.ctrlKey;
          if (e.key === 'Enter' && modifier) {
            e.preventDefault();
            if (streaming) onCancel();
            else sendNow();
          }
        }}
      />
      <button
        type={streaming ? 'button' : 'submit'}
        className="chat-composer__action"
        aria-label={streaming ? 'Stop' : 'Send'}
        disabled={!streaming && (disabled === true || text.trim().length === 0)}
        onClick={streaming ? onCancel : undefined}
      >
        {streaming ? <StopIcon size={14} /> : <SendIcon size={14} />}
      </button>
    </form>
  );
}
