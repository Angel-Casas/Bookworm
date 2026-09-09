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

/**
 * How long to wait for the new worker to take over before reloading anyway.
 *
 * Skipping the wait and activating usually takes a few hundred milliseconds.
 * This is not a deadline for that — it is the answer to the case where the
 * hand-over never happens at all, and the plate would otherwise sit there
 * saying "Reloading…" for the rest of the reader's life.
 */
const HANDOVER_MS = 2500

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
      // Ask the worker that is waiting to stop waiting…
      await update(true)
      // …and then make sure the page actually turns over. See below.
      await handOver()
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

/**
 * Reload onto the new worker — and reload even if it never announces itself.
 *
 * The plate said "Reloading…" and stayed there. Everything up to that point
 * had worked: the new worker was installed, waiting, and it did skip the wait
 * when asked. What never came was the RELOAD, because the library performs
 * that inside a `controlling` listener and only when its `isUpdate` flag is
 * set — and that flag is `Boolean(navigator.serviceWorker.controller)` read at
 * registration, i.e. "was this page already being served by a worker".
 *
 * A page that is NOT under a worker is the whole problem. It happens on a
 * first visit, and — much more often than that — after a hard reload, which is
 * exactly what someone does when they suspect they are looking at a stale
 * build. Such a page is never claimed (a prompt-style worker does not claim
 * clients: it must not swap the page out from under a reader who has not said
 * yes), so `controllerchange` never fires, so the reload never runs, and the
 * button spins forever having in fact done its job.
 *
 * So the reload is ours to do. The hand-over is still waited for, because a
 * reload issued a moment too early is served by the OLD worker and lands the
 * reader right back where they were — but it is waited for with an end to it.
 */
function handOver(): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0
    let reloading = false
    const go = (): void => {
      if (reloading) return
      reloading = true
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', go)
      window.location.reload()
      resolve()
    }
    navigator.serviceWorker.addEventListener('controllerchange', go)
    timer = window.setTimeout(go, HANDOVER_MS)
  })
}
