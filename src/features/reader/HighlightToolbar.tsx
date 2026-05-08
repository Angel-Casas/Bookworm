import { useEffect, useRef } from 'react';
import type { HighlightColor } from '@/domain/annotations/types';
import { ChatIcon, NoteIcon } from '@/shared/icons';
import { HIGHLIGHT_COLORS, COLOR_HEX } from './highlightColors';
import './highlight-toolbar.css';

type Mode = 'create' | 'edit';

type Props = {
  readonly mode: Mode;
  readonly screenRect: { x: number; y: number; width: number; height: number };
  readonly currentColor?: HighlightColor;
  readonly onPickColor: (color: HighlightColor) => void;
  readonly onDelete?: () => void;
  readonly onNote?: () => void;
  readonly hasNote?: boolean;
  readonly onDismiss: () => void;
  // Phase 4.4 passage mode. Both must be defined+true for the button to render.
  readonly onAskAI?: () => void;
  readonly canAskAI?: boolean;
  // Phase 5.5 multi-excerpt mode. The button renders whenever onAddToCompare
  // is provided; it disables (with a "full" tooltip) when canAddToCompare is
  // explicitly false.
  readonly onAddToCompare?: () => void;
  readonly canAddToCompare?: boolean;
};

const TOOLBAR_HEIGHT = 36;
const GAP = 8;

export function HighlightToolbar({
  mode,
  screenRect,
  currentColor,
  onPickColor,
  onDelete,
  onNote,
  hasNote,
  onDismiss,
  onAskAI,
  canAskAI,
  onAddToCompare,
  canAddToCompare,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onScroll = (): void => {
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onDismiss]);

  // Clamp position inside the viewport so off-screen selections (e.g. text
  // hidden behind a paginated EPUB column transform) still render a tappable
  // toolbar near the top of the visible area instead of off-screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const flipBelow = screenRect.y < TOOLBAR_HEIGHT + GAP;
  const rawTop = flipBelow
    ? screenRect.y + screenRect.height + GAP
    : screenRect.y - TOOLBAR_HEIGHT - GAP;
  const top = Math.max(8, Math.min(vh - TOOLBAR_HEIGHT - 8, rawTop));
  // The toolbar can host up to 4 color swatches + Note + Ask AI + + Compare
  // + Delete; widest case is ~360px. Clamp center so the leftmost/rightmost
  // button stays inside the viewport (transform: translateX(-50%) means
  // center must be at least half the toolbar width from each edge).
  const rawLeft = screenRect.x + screenRect.width / 2;
  const left = Math.max(180, Math.min(vw - 180, rawLeft));

  return (
    <div
      ref={ref}
      className="highlight-toolbar"
      role="toolbar"
      aria-label={mode === 'create' ? 'Pick a highlight color' : 'Edit highlight'}
      style={{
        top: `${String(top)}px`,
        left: `${String(left)}px`,
        transform: 'translateX(-50%)',
      }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="highlight-toolbar__color"
          aria-label={color}
          aria-pressed={mode === 'edit' ? color === currentColor : false}
          style={{ background: COLOR_HEX[color] }}
          onClick={() => {
            onPickColor(color);
          }}
        />
      ))}
      {onNote ? (
        <>
          <span className="highlight-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className={
              mode === 'edit' && hasNote
                ? 'highlight-toolbar__note highlight-toolbar__note--active'
                : 'highlight-toolbar__note'
            }
            aria-label={mode === 'edit' && hasNote ? 'Edit note' : 'Add note'}
            onClick={onNote}
          >
            <NoteIcon />
          </button>
        </>
      ) : null}
      {onAskAI && canAskAI === true ? (
        <>
          <span className="highlight-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="highlight-toolbar__ask-ai"
            aria-label="Ask AI about this passage"
            onClick={() => {
              onDismiss();
              onAskAI();
            }}
          >
            <ChatIcon />
          </button>
        </>
      ) : null}
      {onAddToCompare ? (
        <>
          <span className="highlight-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="highlight-toolbar__compare"
            aria-label={
              canAddToCompare === false ? 'Compare set full (6)' : 'Add to compare'
            }
            title={
              canAddToCompare === false
                ? 'Compare set full (6) — remove an excerpt to add another'
                : 'Add to compare'
            }
            disabled={canAddToCompare === false}
            onClick={() => {
              onDismiss();
              onAddToCompare();
            }}
          >
            + Compare
          </button>
        </>
      ) : null}
      {mode === 'edit' && onDelete ? (
        <>
          <span className="highlight-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="highlight-toolbar__delete"
            aria-label="Delete highlight"
            onClick={onDelete}
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
