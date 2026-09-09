/**
 * Putting Bookworm on the device, and the one moment the browser lets you ask.
 *
 * A browser decides for itself whether a site is installable, and tells the
 * page by firing `beforeinstallprompt` — once, unannounced, and only where the
 * feature exists at all (Chrome and the browsers built on it; Safari has no
 * such event and installs from its own Share menu). The event is also the ONLY
 * handle on the install dialogue: it cannot be conjured later, so it is caught
 * and kept.
 *
 * `preventDefault()` is what stops the browser putting up its own bar at the
 * bottom of the screen. That is the whole reason to intercept it: the offer is
 * made once, in the app's own voice, in a plate the reader can wave away —
 * rather than by a strip of browser chrome over the book they are reading.
 */

/** The event Chrome fires, which no lib.dom typing knows about. */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  prompt: () => Promise<void>
}

export interface InstallWatch {
  /** The browser has said the app can be installed, and handed over the offer. */
  onAvailable: () => void
  /** It is on the device now — by our button, or by the browser's own menu. */
  onInstalled: () => void
}

export type OfferOutcome = 'accepted' | 'dismissed' | 'unavailable'
/** Puts the browser's install dialogue up. Only ever answers once. */
export type OfferInstall = () => Promise<OfferOutcome>

/**
 * Whether the app is already running as an app.
 *
 * Two ways of asking, because iOS answered the question years before it
 * agreed on the standard one, and still answers only its own.
 */
export function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
  } catch {
    // No matchMedia: fall through to the iOS flag.
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * Whether this is an iOS browser, where the offer has to be made in words.
 *
 * Every browser on an iPhone or iPad is Safari underneath, none of them fires
 * `beforeinstallprompt`, and all of them install the same way: Share, then Add
 * to Home Screen. So the one platform where a reading app most wants to be an
 * app is the one platform that will never hand over a button — which leaves
 * saying so, or saying nothing.
 *
 * Sniffing the agent string is a poor way to know anything, and it is the only
 * way to know this. It is kept honest by what rides on it: a sentence, shown
 * once, with no button on it. A browser wrongly told it can add Bookworm to a
 * home screen has been told something true about almost every phone.
 */
export function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // An iPad on a recent iPadOS says it is a Mac. A Mac with a touchscreen is
  // the thing that does not exist.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
}

export function watchInstall(watch: InstallWatch): OfferInstall {
  let offer: BeforeInstallPromptEvent | null = null

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    offer = event as BeforeInstallPromptEvent
    watch.onAvailable()
  })

  window.addEventListener('appinstalled', () => {
    offer = null
    watch.onInstalled()
  })

  return async () => {
    const pending = offer
    if (!pending) return 'unavailable'
    // Spent on use, taken or refused: a second `prompt()` on the same event
    // throws, so it is dropped before it is used rather than after.
    offer = null
    try {
      await pending.prompt()
      return (await pending.userChoice).outcome
    } catch {
      return 'unavailable'
    }
  }
}
