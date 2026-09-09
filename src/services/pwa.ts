/**
 * The service worker, and the one question it is allowed to ask.
 *
 * Bookworm is a static site cached for offline reading, which means a visitor
 * who already has it keeps running the copy they have until a new worker is
 * installed AND takes over. Both halves matter: a deploy that has landed on the
 * server has not landed on the reader, and there is nothing on screen to say
 * so. That gap cost a real afternoon — a fix was live, tested against a build
 * three commits old, and reported as still broken.
 *
 * So the update is not applied silently. `needRefresh` goes true when a new
 * worker is waiting; calling the function it hands back is what lets it
 * through, and the page reloads on the reader's word rather than mid-sentence.
 *
 * A thin wrapper over `virtual:pwa-register`, which exists only in a build —
 * hence the dynamic import and the quiet failure. In dev, and in a browser with
 * no service worker at all, this simply never fires.
 */

export interface UpdateWatch {
  /** Called when a new version is installed and waiting to take over. */
  onWaiting: () => void
}

/**
 * How often an open tab asks whether there is a newer Bookworm.
 *
 * Registering a worker checks ONCE, on the way in. Nothing after that: a
 * browser only re-checks the script when the page navigates, so a reader who
 * leaves the app open — which is what a reader does with a book — is told
 * about a new version the next time they happen to reload, and not before.
 * That is the whole of why an update could be live for half an hour with the
 * app sitting there saying nothing.
 *
 * Fifteen minutes is chosen against what the check costs: one conditional
 * request for a 3 KB script, which is nothing, against a reader learning about
 * a fix within a quarter of an hour rather than at their next reload.
 */
const CHECK_EVERY_MS = 15 * 60 * 1000

/** Applies the waiting update and reloads. Null until there is one to apply. */
export type ApplyUpdate = (() => Promise<void>) | null

export async function watchForUpdate(watch: UpdateWatch): Promise<ApplyUpdate> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const { registerSW } = await import('virtual:pwa-register')
    const update = registerSW({
      immediate: true,
      onNeedRefresh: watch.onWaiting,
      onRegisteredSW: (_url, registration) => {
        if (!registration) return
        keepAsking(registration, watch)
      },
    })
    return async () => {
      await update(true)
    }
  } catch {
    // No worker registered (dev server, unsupported browser, blocked by
    // policy). The app runs exactly as before; it just never asks.
    return null
  }
}

/**
 * Ask again, on a timer and whenever the tab comes back to life.
 *
 * `registration.update()` is the same check the browser does on a navigation:
 * it re-fetches the worker script past the HTTP cache and, if a byte of it has
 * changed, installs the new one — which is what makes `onNeedRefresh` fire.
 *
 * Three prompts to ask, because they catch different readers. The interval is
 * for a tab left open all afternoon. The visibility change is for a phone,
 * where "open" and "in front of you" are different things and background
 * timers are throttled to nothing — coming back to the app is the moment that
 * matters there. And `online` is for the reader who was on a train: a check
 * that failed with no network should not wait out the rest of its interval.
 *
 * Every one of them is allowed to fail silently. A failed update check means
 * exactly what no update check means — the app the reader has keeps working —
 * and there is nothing to say about it on screen.
 */
function keepAsking(registration: ServiceWorkerRegistration, watch: UpdateWatch): void {
  const ask = (): void => {
    if (navigator.onLine === false) return
    void registration.update().catch(() => {})
  }
  window.setInterval(ask, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ask()
  })
  window.addEventListener('online', ask)
  /*
   * And one that needs no asking: a worker that finished installing while this
   * tab was somewhere else is already waiting when we arrive. workbox-window
   * announces that too, but only for a registration it made itself — this
   * covers the tab that was handed one that was already there.
   */
  if (registration.waiting) watch.onWaiting()
}
