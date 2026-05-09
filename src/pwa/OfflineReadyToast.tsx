import { useEffect } from 'react';
import { useSwUpdates } from './swUpdateStore';
import './sw-toast.css';

const AUTO_DISMISS_MS = 8000;

export function OfflineReadyToast() {
  const { offlineReady, dismissOfflineReady } = useSwUpdates();
  useEffect(() => {
    if (!offlineReady) return;
    const timer = window.setTimeout(dismissOfflineReady, AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [offlineReady, dismissOfflineReady]);

  if (!offlineReady) return null;
  return (
    <div className="sw-toast sw-toast--ready" role="status" aria-live="polite">
      <div className="sw-toast__body">
        <p className="sw-toast__title">Bookworm is ready offline.</p>
      </div>
      <button
        type="button"
        className="sw-toast__dismiss"
        aria-label="Dismiss"
        onClick={dismissOfflineReady}
      >
        ✕
      </button>
    </div>
  );
}
