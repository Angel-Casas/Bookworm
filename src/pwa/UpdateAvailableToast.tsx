import { useSwUpdates } from './swUpdateStore';
import './sw-toast.css';

export function UpdateAvailableToast() {
  const { needsRefresh, applyUpdate, dismissNeedsRefresh } = useSwUpdates();
  if (!needsRefresh) return null;
  return (
    <div
      className="sw-toast sw-toast--update motion-rise"
      role="status"
      aria-live="polite"
    >
      <div className="sw-toast__body">
        <p className="sw-toast__title">An update is available.</p>
        <p className="sw-toast__text">Reload to get the latest Bookworm.</p>
      </div>
      <div className="sw-toast__actions">
        <button
          type="button"
          className="sw-toast__primary"
          onClick={() => {
            void applyUpdate();
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          className="sw-toast__dismiss"
          aria-label="Dismiss"
          onClick={dismissNeedsRefresh}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
