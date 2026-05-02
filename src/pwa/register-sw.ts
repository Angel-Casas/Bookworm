import { registerSW } from 'virtual:pwa-register';

// Phase 0 wiring only. The user-facing "update available" / "offline ready"
// prompt UI lands with the polish phase; here we just register the worker so
// the offline shell exists from build day one.
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;

  registerSW({
    immediate: true,
    onNeedRefresh() {
      // TODO: surface the update-available prompt in Phase 6.
    },
    onOfflineReady() {
      // TODO: surface the "offline ready" toast in Phase 6.
    },
  });
}
