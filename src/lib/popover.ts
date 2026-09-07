/**
 * Fitting a popover into the window it opens in.
 *
 * A popover anchored to a control is positioned relative to THAT control, and
 * so knows nothing about the edges of the screen. On a wide window it never
 * matters; on a phone it is the whole ballgame — a sheet right-aligned to a
 * trigger near the right edge hangs off the left of the screen, and half its
 * content becomes unreachable.
 *
 * Both answers here are pure arithmetic, so they can be tested without a
 * browser and shared by every popover in the app.
 */

export interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

export interface DropOptions {
  /** Fixed chrome at the top of the window that the popover must clear. */
  topInset?: number
  /** Breathing room at the bottom. */
  bottomMargin?: number
  /** The height it would like, if the room is there. */
  wanted?: number
  /** The height below which it is not worth opening small. */
  min?: number
}

export interface Drop {
  /** True to open above the anchor rather than below it. */
  up: boolean
  maxHeight: number
}

/**
 * Which way a popover should open from its anchor, and how tall it may be.
 * It opens downward unless there is more room above AND below is too tight —
 * a popover that flips for a few pixels' gain would just look restless.
 */
export function dropFrom(anchor: Bounds, viewportHeight: number, options: DropOptions = {}): Drop {
  const topInset = options.topInset ?? 0
  const bottomMargin = options.bottomMargin ?? 8
  const wanted = options.wanted ?? 480
  const min = options.min ?? 200

  const below = viewportHeight - anchor.bottom - bottomMargin
  const above = anchor.top - topInset
  const up = above > below && below < wanted
  return { up, maxHeight: Math.max(min, Math.min(wanted, up ? above : below)) }
}

/**
 * How far to slide a popover sideways so it sits inside the window: positive
 * to the right, negative to the left, zero when it already fits.
 *
 * When the popover is wider than the window it is pinned to the left edge —
 * something has to overflow, and the left is where reading starts.
 */
export function shiftIntoView(box: Bounds, viewportWidth: number, margin = 8): number {
  const width = box.right - box.left
  if (width >= viewportWidth - margin * 2) return margin - box.left
  if (box.left < margin) return margin - box.left
  if (box.right > viewportWidth - margin) return viewportWidth - margin - box.right
  return 0
}
