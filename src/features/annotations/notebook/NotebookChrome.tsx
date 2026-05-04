import { ArrowLeftIcon } from '@/shared/icons';
import './notebook-chrome.css';

type Props = {
  readonly bookTitle: string;
  readonly onBack: () => void;
};

export function NotebookChrome({ bookTitle, onBack }: Props) {
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
    </header>
  );
}
