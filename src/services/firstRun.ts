/**
 * The first-run facts, and carrying them into the installed app.
 *
 * Bookworm asks a first-time reader three things once — their language, the
 * tour, the note that it can be installed — and remembers the answers in
 * localStorage. On Android and desktop an installed app shares that storage
 * with the browser it came from, so nothing is asked twice.
 *
 * iOS does not share. An app added to the Home Screen starts with EMPTY
 * storage of its own: no localStorage, no IndexedDB, no service worker, no
 * cookies from the Safari tab it was added from. So a reader who answered
 * everything in Safari opened the app and was asked it all again — and was
 * offered, of all things, to install the app they were already inside.
 *
 * Two things close that gap:
 *
 *  1. HANDOFF. While Safari is open, the page's manifest is re-pointed at a
 *     start URL that carries the answers (`?bw_lang=es&bw_tour=1`). Safari
 *     reads the manifest at the moment "Add to Home Screen" is pressed, so the
 *     app's first launch opens on that URL and the answers are written into
 *     its own storage before anything asks. Best effort: if a Safari version
 *     ignores a manifest changed after load, step 2 still holds.
 *
 *  2. SETTLED ON ARRIVAL. An installed app with nothing handed over is not a
 *     first visit — on iOS the only way in is through Safari, where the reader
 *     has already met the app. So it does not re-run the tour or the language
 *     chooser; it uses the device's language and points at the globe instead.
 *
 * The storage keys live here, not in the stores that read them, because this
 * module writes them before any store exists.
 */

export const LANGUAGE_KEY = 'bookworm.language.v1'
export const LANGUAGE_HINT_KEY = 'bookworm.languageHintSeen.v1'
export const TOUR_SEEN_KEY = 'bookworm.tourSeen.v1'
export const INSTALL_HINT_KEY = 'bookworm.installHintSeen.v1'
/** Set once the landing page has been shown: after that the app opens on the
 *  shelf, and the landing page is where the medallion takes you. */
export const LANDING_SEEN_KEY = 'bookworm.landingSeen.v1'

const PARAM_LANG = 'bw_lang'
const PARAM_TOUR = 'bw_tour'

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode): the fact holds for this visit only.
  }
}

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

export function landingSeen(): boolean {
  return readPref(LANDING_SEEN_KEY) !== null
}

export function markLandingSeen(): void {
  writePref(LANDING_SEEN_KEY, 'seen')
}

/**
 * Run once, before the stores and the router exist.
 *
 * Takes whatever was handed over in the address, writes it where the stores
 * will find it, and tidies the address so the parameters are never seen or
 * bookmarked. Then, if this is the installed app, settles what an installed
 * app should never ask.
 */
export function acceptHandoff(): void {
  let url: URL
  try {
    url = new URL(window.location.href)
  } catch {
    return
  }
  const lang = url.searchParams.get(PARAM_LANG)
  const tour = url.searchParams.get(PARAM_TOUR)
  // Only fill what this storage does not already know: a reader who changed
  // their language inside the app must not have it reset by the icon's URL.
  if (lang && readPref(LANGUAGE_KEY) === null) writePref(LANGUAGE_KEY, lang)
  if (tour === '1' && readPref(TOUR_SEEN_KEY) === null) writePref(TOUR_SEEN_KEY, 'seen')
  if (lang !== null || tour !== null) {
    url.searchParams.delete(PARAM_LANG)
    url.searchParams.delete(PARAM_TOUR)
    try {
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // A URL we cannot tidy is untidy, not broken.
    }
  }

  if (!isStandalone()) return
  // Inside the app. It has been installed, so there is nothing to offer; the
  // reader came through the browser, so the tour and the landing page have
  // had their turn there.
  writePref(INSTALL_HINT_KEY, 'seen')
  writePref(LANDING_SEEN_KEY, 'seen')
  if (readPref(TOUR_SEEN_KEY) === null) writePref(TOUR_SEEN_KEY, 'seen')
}

interface Manifest {
  start_url?: string
  scope?: string
  id?: string
  icons?: { src: string }[]
  [key: string]: unknown
}

let original: { href: string; manifest: Manifest } | null = null
let loading: Promise<void> | null = null

async function loadOriginal(link: HTMLLinkElement): Promise<void> {
  const href = link.href
  const response = await fetch(href)
  if (!response.ok) throw new Error(`manifest ${response.status}`)
  original = { href, manifest: (await response.json()) as Manifest }
}

/**
 * Point "Add to Home Screen" at a start URL that carries these answers.
 *
 * A data: manifest has no address of its own to resolve relative URLs
 * against, so every URL in it is made absolute from the real manifest's.
 * The `id` is pinned to the plain start URL so the app keeps one identity
 * whatever the parameters say.
 *
 * Only ever called in an iOS browser tab: Chrome decides installability from
 * the manifest and should keep reading the real file.
 */
export async function pointInstallAt(state: {
  lang: string | null
  tourSeen: boolean
}): Promise<void> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) return
  try {
    if (!original) {
      loading ??= loadOriginal(link)
      await loading
    }
  } catch {
    // Offline, or no manifest to read: Safari keeps the plain one, and the
    // installed app settles itself on arrival instead.
    loading = null
    return
  }
  if (!original) return
  const base = original.href
  const abs = (value: string | undefined, fallback: string): string =>
    new URL(value ?? fallback, base).href
  const manifest: Manifest = { ...original.manifest }
  const plainStart = abs(original.manifest.start_url, './')
  const start = new URL(plainStart)
  if (state.lang) start.searchParams.set(PARAM_LANG, state.lang)
  if (state.tourSeen) start.searchParams.set(PARAM_TOUR, '1')
  manifest.start_url = start.href
  manifest.scope = abs(original.manifest.scope, './')
  manifest.id = abs(original.manifest.id, plainStart)
  if (original.manifest.icons) {
    manifest.icons = original.manifest.icons.map((icon) => ({
      ...icon,
      src: abs(icon.src, icon.src),
    }))
  }
  link.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`
}
