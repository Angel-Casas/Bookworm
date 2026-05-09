import { ArrowLeftIcon } from '@/shared/icons';
import './notebook-chrome.css';

type Props = {
  readonly bookTitle: string;
  readonly onBack: () => void;
  readonly onExport: () => void;
  readonly canExport: boolean;
};

export function NotebookChrome({ bookTitle, onBack, onExport, canExport }: Props) {
  return (
    <header className="notebook-chrome">
      <button
        type="button"
        className="notebook-chrome__back"
        onClick={onBack}
        aria-label="Back to reader"
      >
        <ArrowLeftIcon />
        <span>Reader</span>
      </button>
      <div className="notebook-chrome__title" aria-live="polite">
        <span className="notebook-chrome__title-label">Notebook</span>
        <span className="notebook-chrome__title-sep" aria-hidden="true">
          {' · '}
        </span>
        <span className="notebook-chrome__title-book">{bookTitle}</span>
      </div>
      <div className="notebook-chrome__actions">
        <button
          type="button"
          className="notebook-chrome__action"
          onClick={onExport}
          disabled={!canExport}
          aria-label="Export notebook"
          {...(canExport ? {} : { title: 'No entries to export' })}
        >
          Export
        </button>
      </div>
    </header>
  );
}
