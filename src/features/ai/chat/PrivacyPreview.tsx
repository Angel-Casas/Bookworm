import { useState } from 'react';
import { buildOpenModeSystemPrompt, buildPassageBlockForPreview } from './promptAssembly';
import type { AttachedPassage } from './useChatSend';

type Props = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly modelId: string;
  readonly historyCount: number;
  // Phase 4.4. When non-null, summary + expanded form gain a passage section
  // showing exactly what assemblePassageChatPrompt embeds in the user message.
  readonly attachedPassage?: AttachedPassage | null;
};

export function PrivacyPreview({
  book,
  modelId,
  historyCount,
  attachedPassage,
}: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const passage = attachedPassage ?? null;

  const summaryParts: string[] = [
    `${book.title}${book.author ? ` by ${book.author}` : ''}`,
  ];
  if (passage !== null) {
    if (passage.sectionTitle !== undefined) summaryParts.push(passage.sectionTitle);
    summaryParts.push(`selected passage (~${String(passage.text.length)} chars)`);
  }
  summaryParts.push(`${String(historyCount)} prior messages`);
  const summary = `Sending: ${summaryParts.join(' + ')} → ${modelId}`;

  const prompt = buildOpenModeSystemPrompt(book);

  // The passage block we render in the expanded form is character-for-
  // character what assemblePassageChatPrompt embeds in the user message —
  // built via the same shared helper to prevent drift.
  const passageBlock =
    passage !== null
      ? buildPassageBlockForPreview(book.title, {
          text: passage.text,
          ...(passage.sectionTitle !== undefined && {
            sectionTitle: passage.sectionTitle,
          }),
          ...(passage.windowBefore !== undefined && {
            windowBefore: passage.windowBefore,
          }),
          ...(passage.windowAfter !== undefined && {
            windowAfter: passage.windowAfter,
          }),
        })
      : null;

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
          {passageBlock !== null ? (
            <>
              <h4>Attached passage</h4>
              <pre className="privacy-preview__prompt">{passageBlock}</pre>
            </>
          ) : null}
          <h4>Model</h4>
          <p>{modelId}</p>
          <h4>Messages included</h4>
          <p>1 system + {historyCount} prior</p>
        </div>
      ) : null}
    </div>
  );
}
