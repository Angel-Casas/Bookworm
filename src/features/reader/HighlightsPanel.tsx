import type { Highlight, HighlightColor } from '@/domain/annotations/types';
import { relativeTime } from '@/shared/text/relativeTime';
import { HIGHLIGHT_COLORS, COLOR_HEX } from './highlightColors';
import './highlights-panel.css';

type Props = {
  readonly highlights: readonly Highlight[];
  readonly onSelect: (h: Highlight) => void;
  readonly onDelete: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly nowMs?: number;
};

export function HighlightsPanel({
  highlights,
  onSelect,
  onDelete,
  onChangeColor,
  nowMs,
}: Props) {
  if (highlights.length === 0) {
    return (
      <aside className="highlights-panel highlights-panel--empty" aria-label="Highlights">
        <p className="highlights-panel__empty-icon" aria-hidden="true">
          ✎
        </p>
        <p className="highlights-panel__empty-title">No highlights yet</p>
        <p className="highlights-panel__empty-hint">
          Select text in the reader and tap a color.
        </p>
      </aside>
    );
  }
  return (
    <aside className="highlights-panel" aria-label="Highlights">
      <ul className="highlights-panel__list">
        {highlights.map((h) => (
          <li key={h.id} className="highlights-panel__item">
            <span
              className="highlights-panel__bar"
              data-color={h.color}
              style={{ background: COLOR_HEX[h.color] }}
              aria-hidden="true"
            />
            <button
              type="button"
              className="highlights-panel__row"
              aria-label={h.sectionTitle ?? '—'}
              onClick={() => {
                onSelect(h);
              }}
            >
              <span className="highlights-panel__top">
                <span className="highlights-panel__section">{h.sectionTitle ?? '—'}</span>
                <span className="highlights-panel__time">{relativeTime(h.createdAt, nowMs)}</span>
              </span>
              <span className="highlights-panel__text">{h.selectedText}</span>
            </button>
            <span className="highlights-panel__actions">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="highlights-panel__color"
                  aria-label={`Set color to ${color}`}
                  aria-pressed={color === h.color}
                  style={{ background: COLOR_HEX[color] }}
                  onClick={() => {
                    onChangeColor(h, color);
                  }}
                />
              ))}
              <button
                type="button"
                className="highlights-panel__delete"
                aria-label="Remove highlight"
                onClick={() => {
                  onDelete(h);
                }}
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
