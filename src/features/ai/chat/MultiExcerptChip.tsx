import { useState } from 'react';
import type { HighlightAnchor } from '@/domain/annotations/types';
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';

const SNIPPET_CHARS = 50;

function snippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SNIPPET_CHARS) return trimmed;
  return `${trimmed.slice(0, SNIPPET_CHARS).trimEnd()}…`;
}

type Props = {
  readonly excerpts: readonly AttachedExcerpt[];
  readonly onClear: () => void;
  readonly onRemoveExcerpt: (id: string) => void;
  readonly onJumpToExcerpt: (anchor: HighlightAnchor) => void;
};

export function MultiExcerptChip({
  excerpts,
  onClear,
  onRemoveExcerpt,
  onJumpToExcerpt,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  if (excerpts.length === 0) return null;

  const countLabel = `${String(excerpts.length)} excerpt${excerpts.length === 1 ? '' : 's'}`;

  return (
    <div className="multi-excerpt-chip" role="status" aria-live="polite">
      <div className="multi-excerpt-chip__header">
        <button
          type="button"
          className="multi-excerpt-chip__toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          <span aria-hidden="true">📑</span>
          <span>{countLabel}</span>
          <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </button>
        <button
          type="button"
          className="multi-excerpt-chip__clear"
          aria-label="Clear compare set"
          onClick={onClear}
        >
          ×
        </button>
      </div>
      {expanded ? (
        <ol className="multi-excerpt-chip__list">
          {excerpts.map((e, idx) => (
            <li key={e.id} className="multi-excerpt-chip__item">
              <span className="multi-excerpt-chip__index">{idx + 1}.</span>
              <span className="multi-excerpt-chip__section">{e.sectionTitle}</span>
              <span className="multi-excerpt-chip__separator" aria-hidden="true">
                ·
              </span>
              <span className="multi-excerpt-chip__snippet">"{snippet(e.text)}"</span>
              <button
                type="button"
                className="multi-excerpt-chip__jump"
                aria-label={`Jump to ${e.sectionTitle}`}
                onClick={() => {
                  onJumpToExcerpt(e.anchor);
                }}
              >
                ⏎
              </button>
              <button
                type="button"
                className="multi-excerpt-chip__remove"
                aria-label="Remove from compare"
                onClick={() => {
                  onRemoveExcerpt(e.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
