import { useState } from 'react';
import './reader-chrome.css';

type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly onOpenToc: () => void;
  readonly onOpenTypography: () => void;
  readonly onToggleFocus: () => void;
  readonly onAddBookmark: () => void;
  readonly showTocButton?: boolean;
  readonly showFocusToggle?: boolean;
  readonly focusMode?: 'normal' | 'focus';
};

export function ReaderChrome({
  title,
  subtitle,
  onBack,
  onOpenToc,
  onOpenTypography,
  onToggleFocus,
  onAddBookmark,
  showTocButton = true,
  showFocusToggle = false,
  focusMode = 'normal',
}: Props) {
  const [pulsing, setPulsing] = useState(false);
  const handleAddBookmark = (): void => {
    onAddBookmark();
    setPulsing(true);
    window.setTimeout(() => {
      setPulsing(false);
    }, 250);
  };
  return (
    <header className="reader-chrome">
      <button
        type="button"
        className="reader-chrome__back"
        onClick={onBack}
        aria-label="Back to library"
      >
        ← Library
      </button>
      <div className="reader-chrome__title" aria-live="polite">
        <span className="reader-chrome__title-main">{title}</span>
        {subtitle ? <span className="reader-chrome__title-sub"> — {subtitle}</span> : null}
      </div>
      <div className="reader-chrome__actions">
        {showFocusToggle ? (
          <button
            type="button"
            onClick={onToggleFocus}
            aria-label="Toggle focus mode"
            aria-pressed={focusMode === 'focus'}
            title={focusMode === 'focus' ? 'Exit focus mode (F)' : 'Enter focus mode (F)'}
          >
            {focusMode === 'focus' ? '⊞' : '⊟'}
          </button>
        ) : null}
        <button type="button" onClick={onOpenTypography} aria-label="Reader preferences">
          ⚙
        </button>
        <button
          type="button"
          onClick={handleAddBookmark}
          aria-label="Add bookmark"
          className={
            pulsing
              ? 'reader-chrome__bookmark reader-chrome__bookmark--pulse'
              : 'reader-chrome__bookmark'
          }
          title="Bookmark this spot"
        >
          ★
        </button>
        {showTocButton ? (
          <button type="button" onClick={onOpenToc} aria-label="Table of contents">
            ☰
          </button>
        ) : null}
      </div>
    </header>
  );
}
