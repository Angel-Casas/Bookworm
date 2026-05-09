import { registerSW } from 'virtual:pwa-register';
import { swUpdateStore } from './swUpdateStore';

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      swUpdateStore.getState().markNeedsRefresh();
    },
    onOfflineReady() {
      swUpdateStore.getState().markOfflineReady();
    },
  });

  swUpdateStore.getState().setApplyUpdate(async () => {
    await updateSW(true);
  });
}
