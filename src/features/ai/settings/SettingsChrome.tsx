import { ArrowLeftIcon } from '@/shared/icons';
import './settings-chrome.css';

type Props = {
  readonly onClose: () => void;
};

export function SettingsChrome({ onClose }: Props) {
  return (
    <header className="settings-chrome">
      <button
        type="button"
        className="settings-chrome__back"
        onClick={onClose}
        aria-label="Back to library"
      >
        <ArrowLeftIcon />
        <span>Library</span>
      </button>
      <h1 className="settings-chrome__title">Settings</h1>
    </header>
  );
}
