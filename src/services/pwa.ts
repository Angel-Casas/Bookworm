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

/** Applies the waiting update and reloads. Null until there is one to apply. */
export type ApplyUpdate = (() => Promise<void>) | null

export async function watchForUpdate(watch: UpdateWatch): Promise<ApplyUpdate> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const { registerSW } = await import('virtual:pwa-register')
    const update = registerSW({
      immediate: true,
      onNeedRefresh: watch.onWaiting,
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
