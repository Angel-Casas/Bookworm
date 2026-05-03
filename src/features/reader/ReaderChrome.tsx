import './reader-chrome.css';

type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly onOpenToc: () => void;
  readonly onOpenTypography: () => void;
};

export function ReaderChrome({ title, subtitle, onBack, onOpenToc, onOpenTypography }: Props) {
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
        <button type="button" onClick={onOpenTypography} aria-label="Reader preferences">
          ⚙
        </button>
        <button type="button" onClick={onOpenToc} aria-label="Table of contents">
          ☰
        </button>
      </div>
    </header>
  );
}
