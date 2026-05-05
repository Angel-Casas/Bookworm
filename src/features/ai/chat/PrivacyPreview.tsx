import { useState } from 'react';
import { buildOpenModeSystemPrompt } from './promptAssembly';

type Props = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly modelId: string;
  readonly historyCount: number;
};

export function PrivacyPreview({ book, modelId, historyCount }: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const summary = `Sending: ${book.title}${book.author ? ` by ${book.author}` : ''} + ${String(
    historyCount,
  )} prior messages → ${modelId}`;
  const prompt = buildOpenModeSystemPrompt(book);
  return (
    <div className={open ? 'privacy-preview privacy-preview--open' : 'privacy-preview'}>
      <button
        type="button"
        className="privacy-preview__summary"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        ⓘ {summary}
      </button>
      {open ? (
        <div className="privacy-preview__body">
          <h4>System prompt</h4>
          <pre className="privacy-preview__prompt">{prompt}</pre>
          <h4>Model</h4>
          <p>{modelId}</p>
          <h4>Messages included</h4>
          <p>1 system + {historyCount} prior</p>
        </div>
      ) : null}
    </div>
  );
}
