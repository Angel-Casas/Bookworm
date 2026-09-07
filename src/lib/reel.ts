/**
 * Pure core of the scroll-scrubbed landing film ("The Reel").
 * Timing windows are expressed in film seconds and map 1:1 to the storyboard
 * of public/landing/scrub-*.mp4 (13.93s master).
 */

/** Scroll pixels that advance the film by one second. */
export const REEL_SPS = 620

/** Used until the video reports its real duration. */
export const REEL_FALLBACK_DURATION = 13.93

export interface ReelBeat {
  id: string
  /** Film time where the copy begins fading in. */
  fadeInStart: number
  /** Fully visible from here… */
  fullyIn: number
  /** …until here, where fade-out begins. */
  fadeOutStart: number
  /** Fully hidden again. */
  fullyOut: number
  label: string
}

export const REEL_BEATS: readonly ReelBeat[] = [
  {
    id: 'hero',
    fadeInStart: -1.0,
    fullyIn: -0.5,
    fadeOutStart: 0.55,
    fullyOut: 1.05,
    label: 'Prologue',
  },
  {
    id: 'import',
    fadeInStart: 1.05,
    fullyIn: 1.45,
    fadeOutStart: 2.05,
    fullyOut: 2.45,
    label: 'Library',
  },
  {
    id: 'read',
    fadeInStart: 2.55,
    fullyIn: 2.95,
    fadeOutStart: 3.65,
    fullyOut: 4.05,
    label: 'Reading',
  },
  {
    id: 'context',
    fadeInStart: 4.15,
    fullyIn: 4.55,
    fadeOutStart: 5.55,
    fullyOut: 5.95,
    label: 'Context',
  },
  {
    id: 'ink',
    fadeInStart: 6.0,
    fullyIn: 6.25,
    fadeOutStart: 6.55,
    fullyOut: 6.85,
    label: 'Grounding',
  },
  {
    id: 'models',
    fadeInStart: 7.0,
    fullyIn: 7.4,
    fadeOutStart: 8.35,
    fullyOut: 8.75,
    label: 'Minds',
  },
  { id: 'ask', fadeInStart: 8.95, fullyIn: 9.3, fadeOutStart: 10.05, fullyOut: 10.4, label: 'Ask' },
  {
    id: 'receipts',
    fadeInStart: 10.5,
    fullyIn: 10.9,
    fadeOutStart: 12.1,
    fullyOut: 12.55,
    label: 'Receipts',
  },
  {
    id: 'final',
    fadeInStart: 12.95,
    fullyIn: 13.45,
    fadeOutStart: 99,
    fullyOut: 100,
    label: 'Begin',
  },
] as const

/** Hermite smoothstep of t across [edge0, edge1], clamped to [0, 1]. */
export function smoothstep(t: number, edge0: number, edge1: number): number {
  if (edge1 <= edge0) return t >= edge0 ? 1 : 0
  const x = Math.max(0, Math.min(1, (t - edge0) / (edge1 - edge0)))
  return x * x * (3 - 2 * x)
}

/** Opacity of a beat's copy at film time t. */
export function beatOpacity(t: number, beat: ReelBeat): number {
  return (
    smoothstep(t, beat.fadeInStart, beat.fullyIn) *
    (1 - smoothstep(t, beat.fadeOutStart, beat.fullyOut))
  )
}

/** Index of the beat the film time t currently belongs to. */
export function activeBeatIndex(t: number, beats: readonly ReelBeat[]): number {
  let active = 0
  beats.forEach((beat, index) => {
    if (t >= beat.fadeInStart) active = index
  })
  return active
}

/** Pick the right encode for the visitor's viewport and codec support. */
export function chooseReelSource(smallViewport: boolean, canPlayH264: boolean): string {
  if (!canPlayH264) return '/landing/scrub-1920.webm'
  return smallViewport ? '/landing/scrub-960.mp4' : '/landing/scrub-1920.mp4'
}

/** Total scrollable track height for a film of `duration` seconds. */
export function trackHeight(duration: number, viewportHeight: number): number {
  return Math.round(duration * REEL_SPS) + viewportHeight
}

/** Frame-rate-independent smoothing factor for a given frame delta. */
export function expBlend(dtSeconds: number, tau = 0.16): number {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return 1 - Math.exp(-1 / 60 / tau)
  return 1 - Math.exp(-Math.min(dtSeconds, 0.1) / tau)
}

/** Quantize a film time onto the source's frame grid (fewer wasted decodes). */
export function quantizeToFilmFrame(t: number, fps = 30): number {
  return Math.round(t * fps) / fps
}
