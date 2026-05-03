import { useEffect, useRef } from 'react';
import type { HighlightColor } from '@/domain/annotations/types';
import { HIGHLIGHT_COLORS, COLOR_HEX } from './highlightColors';
import './highlight-toolbar.css';

type Mode = 'create' | 'edit';

type Props = {
  readonly mode: Mode;
  readonly screenRect: { x: number; y: number; width: number; height: number };
  readonly currentColor?: HighlightColor;
  readonly onPickColor: (color: HighlightColor) => void;
  readonly onDelete?: () => void;
  readonly onDismiss: () => void;
};

const TOOLBAR_HEIGHT = 36;
const GAP = 8;

export function HighlightToolbar({
  mode,
  screenRect,
  currentColor,
  onPickColor,
  onDelete,
  onDismiss,
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

  const flipBelow = screenRect.y < TOOLBAR_HEIGHT + GAP;
  const top = flipBelow
    ? screenRect.y + screenRect.height + GAP
    : screenRect.y - TOOLBAR_HEIGHT - GAP;
  const left = Math.max(8, screenRect.x + screenRect.width / 2);

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
