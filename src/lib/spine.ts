/**
 * A spine, designed from the cover it belongs to.
 *
 * An EPUB or a PDF carries a front cover and nothing else, so the shelf has to
 * make every spine itself. Pure functions only: everything works on a
 * `PixelGrid` (RGBA, row-major) that services/spinePixels fills from a small
 * canvas. Grown in design-explorations/spine-lab.html.
 *
 * The recipe copies what a designed spine does (see the Vasari shelf):
 *   - its GROUND is the cover's own background, read from the cover's LEFT
 *     edge, because on a real book that is where the spine folds round;
 *   - its INK is a colour already on the cover that reads on that ground, or a
 *     warm neutral when none does;
 *   - its MOTIF is a small piece of the cover's picture, chosen where the
 *     picture is (colour far from the ground) and not where the type is (fine,
 *     busy detail). A cover that is all type gets no motif rather than a
 *     cropped letter.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface PixelGrid {
  width: number
  height: number
  /** RGBA bytes, row-major, length = width * height * 4. */
  data: ArrayLike<number>
}

export interface Swatch {
  color: Rgb
  /** Share of the sampled pixels, 0..1. */
  weight: number
}

/** A rectangle as fractions of the cover, 0..1 on both axes. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface SpineColors {
  ground: Rgb
  ink: Rgb
  accent: Rgb
}

export interface Motif extends Region {
  /** How sure the pick is, 0..1 — below MOTIF_MIN_SCORE there is no motif. */
  score: number
}

export interface TitleFit {
  /** Font size in px. */
  size: number
  /** One line, or two when the title only reads folded (each becomes a column). */
  lines: string[]
}

const CREAM: Rgb = { r: 244, g: 236, b: 220 }
const SOOT: Rgb = { r: 26, g: 21, b: 14 }

/* ----------------------------------------------------------------- colour */

function channel(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance, 0..1. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** HSV saturation, 0..1. */
export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** "Redmean" colour distance: cheap, and close enough to perceived difference. 0..~765. */
export function distance(a: Rgb, b: Rgb): number {
  const rm = (a.r + b.r) / 2
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

export function toCss({ r, g, b }: Rgb): string {
  return `rgb(${r} ${g} ${b})`
}

/* ---------------------------------------------------------------- palette */

const MERGE_DISTANCE = 70

/**
 * The few colours a region is made of, heaviest first.
 *
 * Pixels are bucketed at 4 bits a channel, then neighbouring buckets are merged
 * greedily (heaviest absorbs the near ones), so a gradient or film grain counts
 * as one colour instead of forty.
 */
export function palette(
  grid: PixelGrid,
  region: Region = { x: 0, y: 0, w: 1, h: 1 },
  max = 6,
): Swatch[] {
  const x0 = Math.max(0, Math.floor(region.x * grid.width))
  const y0 = Math.max(0, Math.floor(region.y * grid.height))
  const x1 = Math.min(grid.width, Math.ceil((region.x + region.w) * grid.width))
  const y1 = Math.min(grid.height, Math.ceil((region.y + region.h) * grid.height))

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * grid.width + x) * 4
      if ((grid.data[i + 3] ?? 255) < 128) continue
      const r = grid.data[i]!
      const g = grid.data[i + 1]!
      const b = grid.data[i + 2]!
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.n++
        bucket.r += r
        bucket.g += g
        bucket.b += b
      } else {
        buckets.set(key, { n: 1, r, g, b })
      }
      total++
    }
  }
  if (total === 0) return []

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n)
  const merged: { n: number; r: number; g: number; b: number }[] = []
  for (const bucket of sorted) {
    const color = { r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n }
    const home = merged.find(
      (m) => distance({ r: m.r / m.n, g: m.g / m.n, b: m.b / m.n }, color) < MERGE_DISTANCE,
    )
    if (home) {
      home.n += bucket.n
      home.r += bucket.r
      home.g += bucket.g
      home.b += bucket.b
    } else {
      merged.push({ ...bucket })
    }
  }

  return merged
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((m) => ({
      color: { r: Math.round(m.r / m.n), g: Math.round(m.g / m.n), b: Math.round(m.b / m.n) },
      weight: m.n / total,
    }))
}

/**
 * Ground, ink and accent for a spine.
 *
 * The ground comes from the cover's left edge when that edge is mostly one
 * colour (it is where the spine would fold round); a busy edge — a photograph
 * running off the side — falls back to the cover's heaviest colour. For an
 * AI-drawn spine, `groundFrom` is the plain lower part the title is set on.
 */
/**
 * A warm neutral that reads on `ground`: soot or cream tinted toward the
 * ground first (they sit on it more quietly), plain ones next, and black or
 * white when a mid-tone red leaves nothing else at 4.5:1.
 */
function neutralInk(ground: Rgb): Rgb {
  const candidates = [
    mix(SOOT, ground, 0.1),
    mix(CREAM, ground, 0.08),
    SOOT,
    CREAM,
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
  ]
  return (
    candidates.find((c) => contrast(c, ground) >= 4.5) ??
    candidates.reduce((best, c) => (contrast(c, ground) > contrast(best, ground) ? c : best))
  )
}

export const LEFT_EDGE: Region = { x: 0, y: 0, w: 0.1, h: 1 }

export function spineColors(grid: PixelGrid, groundFrom: Region = LEFT_EDGE): SpineColors {
  const whole = palette(grid, undefined, 8)
  const edge = palette(grid, groundFrom, 3)
  const fallback = whole[0]?.color ?? SOOT
  const ground = edge[0] && edge[0].weight >= 0.4 ? edge[0].color : fallback

  const readable = whole
    .filter((s) => s.weight >= 0.01 && contrast(s.color, ground) >= 4.5)
    .sort((a, b) => b.weight * (0.4 + saturation(b.color)) - a.weight * (0.4 + saturation(a.color)))
  const ink = readable[0]?.color ?? neutralInk(ground)

  const accentPick = whole
    .filter((s) => distance(s.color, ground) > 110 && contrast(s.color, ground) >= 1.6)
    .sort(
      (a, b) =>
        saturation(b.color) * Math.sqrt(b.weight) - saturation(a.color) * Math.sqrt(a.weight),
    )[0]
  const accent = accentPick && saturation(accentPick.color) > 0.25 ? accentPick.color : ink

  return { ground, ink, accent }
}

/** Grounds for a book with no cover to read one from: bindings, not pastels. */
const BINDINGS: readonly Rgb[] = [
  { r: 32, g: 52, b: 88 },
  { r: 120, g: 36, b: 32 },
  { r: 28, g: 78, b: 62 },
  { r: 214, g: 196, b: 160 },
  { r: 46, g: 40, b: 36 },
  { r: 150, g: 104, b: 34 },
]

/**
 * Colours for a coverless book — or for one whose cover has not been read
 * yet. Chosen by the book's id, so the same book is always the same colour
 * and the shelf does not flicker when the real reading arrives.
 */
export function bindingColors(id: string): SpineColors {
  const ground = BINDINGS[hash(id) % BINDINGS.length]!
  const ink = neutralInk(ground)
  return { ground, ink, accent: ink }
}

/* ------------------------------------------------------------------ motif */

export const MOTIF_MIN_SCORE = 0.1
const BLUR_RADIUS = 2
/**
 * Busyness at which a window stops counting at all. A block of set type
 * measures ~0.25 here; drawn line-work (a map, waves, a fine illustration)
 * 0.10–0.15; flat painted shapes under 0.08. The falloff is quadratic, so line-work
 * is discounted rather than ruled out. Tuned on the lab's test covers — check
 * it against real ones before trusting it.
 */
const BUSY_LIMIT = 0.22

/** Box blur of the RGB channels, radius r (a (2r+1)² average), clamped at the edges. */
function boxBlur(data: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy))
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx))
          const i = (yy * w + xx) * 4
          sr += data[i]!
          sg += data[i + 1]!
          sb += data[i + 2]!
          n++
        }
      }
      const o = (y * w + x) * 3
      out[o] = sr / n
      out[o + 1] = sg / n
      out[o + 2] = sb / n
    }
  }
  return out
}

/** Summed-area table, (w+1) x (h+1), so any window sum is four lookups. */
function integral(values: Float32Array, w: number, h: number): Float64Array {
  const s = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += values[y * w + x]!
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1]! + row
    }
  }
  return s
}

function windowSum(
  s: Float64Array,
  w: number,
  x: number,
  y: number,
  ww: number,
  wh: number,
): number {
  const W = w + 1
  return s[(y + wh) * W + x + ww]! - s[y * W + x + ww]! - s[(y + wh) * W + x]! + s[y * W + x]!
}

/**
 * Where on the cover the spine's little picture should come from.
 *
 * `grid` should be small (about 64 px wide): the point is to blur type into
 * texture. Each pixel scores INTEREST (how far it is from the ground, lifted by
 * saturation) and BUSYNESS (a Laplacian on luminance — letters are all edges,
 * a painted sun is mostly flat). A window scores high where it is full of
 * picture and low on busyness, with a gentle pull to the middle of the cover,
 * which is where covers put their subject.
 *
 * `aspect` is the motif box's height / width, so the crop is never stretched.
 * `share` is the window's width as a share of the cover's.
 */
export function findMotif(
  grid: PixelGrid,
  ground: Rgb,
  aspect = 1.2,
  share = 0.42,
  minScore = MOTIF_MIN_SCORE,
): Motif | null {
  const { width: w, height: h, data } = grid
  if (w < 8 || h < 8) return null
  // Interest is read from a BLURRED copy: thin strokes (letters, hairlines,
  // waves drawn as lines, a scatter of stars) average back into the ground and
  // vanish, while a solid shape — a sun, a lantern, a tree — survives whole.
  const soft = boxBlur(data, w, h, BLUR_RADIUS)
  const interest = new Float32Array(w * h)
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const c = { r: soft[i * 3]!, g: soft[i * 3 + 1]!, b: soft[i * 3 + 2]! }
    const away = Math.min(1, distance(c, ground) / 300)
    interest[i] = away * (0.6 + 0.8 * saturation(c))
    lum[i] = (0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!) / 255
  }
  const busy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      busy[i] = Math.abs(4 * lum[i]! - lum[i - 1]! - lum[i + 1]! - lum[i - w]! - lum[i + w]!)
    }
  }
  const si = integral(interest, w, h)
  const sb = integral(busy, w, h)

  const ww = Math.max(4, Math.round(w * share))
  // Window height in grid pixels for the requested aspect.
  const wh = Math.min(h, Math.max(4, Math.round(ww * aspect)))
  const area = ww * wh

  let best: Motif | null = null
  for (let y = 0; y + wh <= h; y++) {
    for (let x = 0; x + ww <= w; x++) {
      const meanI = windowSum(si, w, x, y, ww, wh) / area
      const meanB = windowSum(sb, w, x, y, ww, wh) / area
      const cx = (x + ww / 2) / w - 0.5
      const cy = (y + wh / 2) / h - 0.5
      const centre = 1 - 0.35 * Math.min(1, Math.hypot(cx, cy * 0.8) * 2)
      const score = meanI * Math.max(0, 1 - (meanB / BUSY_LIMIT) ** 2) * centre
      if (!best || score > best.score) {
        best = { x: x / w, y: y / h, w: ww / w, h: wh / h, score }
      }
    }
  }
  return best && best.score >= minScore ? best : null
}

/**
 * Re-centre a motif window on a point (fractions of the cover), keeping its
 * size and keeping it inside the cover. For a hand-picked motif.
 */
export function motifAt(window: Region, cx: number, cy: number): Region {
  const x = Math.min(1 - window.w, Math.max(0, cx - window.w / 2))
  const y = Math.min(1 - window.h, Math.max(0, cy - window.h / 2))
  return { x, y, w: window.w, h: window.h }
}

/* ---------------------------------------------------------- spine geometry */

/** Stable 32-bit hash (FNV-1a) of a string. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * How thick a book is, in px. From the page count when it is known (real
 * books run roughly 100–900 pages), otherwise from the id so a shelf still
 * has rhythm and the same book is always the same width.
 */
export function spineWidth(id: string, pages: number | null, min = 34, max = 56): number {
  if (pages !== null && Number.isFinite(pages) && pages > 0) {
    const t = Math.min(1, Math.max(0, (pages - 100) / 800))
    return Math.round(min + (max - min) * Math.sqrt(t))
  }
  return min + (hash(id) % (max - min + 1))
}

/**
 * The title's size on the spine: as large as the spine's width allows, then
 * shrunk to fit the length; folded at a word into two columns only when one
 * column would fall below a readable size. The fold is the most balanced one,
 * so "The Lantern / Keeper" rather than "The / Lantern Keeper".
 *
 * `advance` is the average letter advance in em for spaced capitals.
 */
export function fitTitle(title: string, length: number, width: number, advance = 0.8): TitleFit {
  const text = title.trim().replace(/\s+/g, ' ')
  const sizeFor = (chars: number, share: number) =>
    Math.min(width * share, length / (Math.max(1, chars) * advance))
  const one = sizeFor(text.length, 0.5)
  const words = text.split(' ')
  if (one >= width * 0.3 || words.length < 2)
    return { size: Math.max(8, Math.floor(one)), lines: [text] }

  let fold: [string, string] = [text, '']
  for (let i = 1; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    if (Math.max(pair[0].length, pair[1].length) < Math.max(fold[0].length, fold[1].length))
      fold = pair
  }
  const two = sizeFor(Math.max(fold[0].length, fold[1].length), 0.32)
  return two > one
    ? { size: Math.max(8, Math.floor(two)), lines: fold }
    : { size: Math.max(8, Math.floor(one)), lines: [text] }
}

/**
 * The title as a spine carries it: the main title only. Subtitles, bracketed
 * dates and a second work bound in the same volume belong on the cover — a
 * spine is read sideways at a glance, and "45 Years in Wall Street (1949) /
 * New Stock Trend Detector (1936)" does not fit one.
 */
export function spineTitle(title: string): string {
  const main = title
    .split(/\s+[/|]\s+|:\s|\s[—–]\s/)[0]!
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return main || title.trim()
}

/** The surname, for the foot of the spine ("VASARI"). */
export function spineAuthor(author: string | null): string {
  if (!author) return ''
  const first = author.split(/[,;&]| and /)[0]!.trim()
  const parts = first.split(/\s+/).filter(Boolean)
  return (parts[parts.length - 1] ?? '').replace(/[.]/g, '')
}
