/**
 * Reading a publisher's colours against a night page.
 *
 * A book brings its own stylesheet, written for paper: black headings, grey
 * captions, a navy rule under a chapter number. Lay that over a coal-dark page
 * and the parts of it that were merely dark become invisible — which is how a
 * table of contents ends up as black text on a black ground.
 *
 * The old rule tried to fix this with `color: inherit !important` on a list of
 * tags. Two things were wrong with it. `inherit` does not mean "the page's
 * colour", it means "whatever my parent computed" — so a `<ul>` or `<section>`
 * the list forgot passed the publisher's black straight down through every
 * child that DID match. And the cure was as blunt as the disease: a book that
 * coloured something deliberately, and legibly, lost it.
 *
 * So the question is asked per element, and only of the colour it actually
 * ends up with: can this be read on the night page? If it can, it is left
 * alone. If it cannot, it is replaced. Everything here is pure — the walking
 * and the measuring of real elements belongs to the reader.
 */

/** The night page's own ground and default ink. */
export const NIGHT_BG = '#16171a'
export const NIGHT_INK = '#e2ddd2'

/** What a link is drawn in when the page is dark. */
export const NIGHT_LINK = '#f0ae2f'

/**
 * The line between readable and not, as a WCAG contrast ratio.
 *
 * 4.5 is the AA threshold for body text and would be the obvious choice, but
 * it is the wrong tool here: a publisher's soft grey caption can sit just under
 * it and still be perfectly readable as the aside it was meant to be. Pushing
 * every one of those to full cream would flatten the book's own typography in
 * the name of a number. 3.0 is AA for large text, and it is where colour stops
 * being a shade and starts being a failure — black on this ground scores 1.2.
 */
export const MIN_CONTRAST = 3

export interface Rgb {
  r: number
  g: number
  b: number
  /** 0 is fully transparent, 1 fully opaque. */
  a: number
}

/**
 * Read a CSS colour as numbers.
 *
 * Only the forms `getComputedStyle` actually returns are handled — `rgb()` and
 * `rgba()`, in both the legacy comma syntax and the modern space-separated one
 * — plus hex, because that is what this module's own constants are written in.
 * A colour it cannot read returns null, and the caller leaves that element
 * alone: guessing at an unknown colour is how you repaint something that was
 * fine.
 */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase()
  if (text.length === 0) return null
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  if (text.startsWith('#')) {
    const hex = text.slice(1)
    const wide = hex.length === 6 || hex.length === 8
    const short = hex.length === 3 || hex.length === 4
    if (!wide && !short) return null
    if (!/^[0-9a-f]+$/.test(hex)) return null
    const at = (index: number): number => {
      const pair = short ? `${hex[index]}${hex[index]}` : `${hex[index * 2]}${hex[index * 2 + 1]}`
      return Number.parseInt(pair, 16)
    }
    const hasAlpha = hex.length === 8 || hex.length === 4
    return { r: at(0), g: at(1), b: at(2), a: hasAlpha ? at(3) / 255 : 1 }
  }

  const match = /^rgba?\(([^)]+)\)$/.exec(text)
  if (!match) return null
  const parts = (match[1] ?? '')
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
  if (parts.length < 3) return null
  const channel = (part: string): number => {
    const n = part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part)
    return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : Number.NaN
  }
  const r = channel(parts[0] as string)
  const g = channel(parts[1] as string)
  const b = channel(parts[2] as string)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  let a = 1
  if (parts.length > 3) {
    const raw = parts[3] as string
    const parsed = raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw)
    a = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1
  }
  return { r, g, b, a }
}

/** Relative luminance, per WCAG 2.1. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two opaque colours: 1 (identical) to 21. */
export function contrastRatio(one: Rgb, two: Rgb): number {
  const a = luminance(one)
  const b = luminance(two)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Lay a partly transparent colour over an opaque one. */
export function flatten(over: Rgb, under: Rgb): Rgb {
  const a = over.a
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
    a: 1,
  }
}

/**
 * Should this element's ink be replaced on the night page?
 *
 * `computed` is the colour the element ended up with, as the browser reports
 * it. `background` is the ground it will actually be read against — the night
 * page, unless something between drew its own.
 *
 * A colour that is fully transparent is not ink at all; the element is showing
 * something else's, and repainting it would make text appear where the book
 * meant none. A colour that cannot be read is replaced. Everything else stays
 * exactly as the publisher set it.
 */
export function needsNightInk(computed: string, background: string = NIGHT_BG): boolean {
  const ink = parseColor(computed)
  if (ink === null) return false
  if (ink.a === 0) return false
  const ground = parseColor(background) ?? parseColor(NIGHT_BG)
  if (ground === null) return false
  const solidGround = ground.a < 1 ? flatten(ground, parseColor(NIGHT_BG) as Rgb) : ground
  const solidInk = ink.a < 1 ? flatten(ink, solidGround) : ink
  return contrastRatio(solidInk, solidGround) < MIN_CONTRAST
}

/**
 * Is this background worth keeping on the night page?
 *
 * A book that puts a pale panel behind a sidebar is drawing a shape, not just
 * a colour, and blanking every background turns that sidebar into ordinary
 * prose. But a pale panel is also a white slab on a dark page. So the ones that
 * are nearly the colour of paper are dropped — the page's own ground shows
 * through and the night stays whole — and the rest are left to be dealt with
 * by the ink test, which measures against them.
 */
export function isPaperish(background: string): boolean {
  const colour = parseColor(background)
  if (colour === null) return false
  if (colour.a === 0) return false
  return luminance({ ...colour, a: 1 }) > 0.55
}
