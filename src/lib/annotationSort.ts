/** Pure ordering for annotations: book order, not arrival order. */
import type { Annotation, BookFormat } from '@/lib/types'

/**
 * Flatten an EPUB CFI into a comparable number sequence. Steps come from the
 * spine/DOM path (`/6/8!/4/2/14`), a `:n` suffix is a character offset at
 * that step, and a range CFI (`base,start,end`) is located at base+start.
 * Bracketed assertions (`[chap01]`) carry no ordering information.
 */
function cfiSteps(cfi: string): number[] {
  let s = cfi.trim()
  if (s.startsWith('epubcfi(') && s.endsWith(')')) s = s.slice(8, -1)
  const parts = s.split(',')
  if (parts.length === 3) s = (parts[0] ?? '') + (parts[1] ?? '')
  const steps: number[] = []
  for (const token of s.split(/[/!]/)) {
    if (token.length === 0) continue
    const match = /^(\d+)(?:\[[^\]]*\])?(?::(\d+))?/.exec(token)
    if (!match) continue
    steps.push(Number(match[1]))
    if (match[2] !== undefined) steps.push(Number(match[2]))
  }
  return steps
}

/** Compare two EPUB CFIs by reading position (negative = a comes first). */
export function compareCfi(a: string, b: string): number {
  const left = cfiSteps(a)
  const right = cfiSteps(b)
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    if (l !== r) return l - r
  }
  // A prefix (no offset / shallower path) sits at that position's start.
  return left.length - right.length
}

/**
 * True when `position` falls inside the inclusive [start, end] CFI range.
 *
 * A reflowable book re-paginates whenever its pane changes (focus mode, type
 * size, a resize), so a stored CFI is only a page START under the layout that
 * created it. Asking "is this mark on the page I'm looking at?" has to be a
 * containment test, never string equality.
 */
export function cfiWithinRange(position: string, start: string, end: string): boolean {
  return compareCfi(position, start) >= 0 && compareCfi(position, end) <= 0
}

/** Compare two annotation positions for the given book format. */
export function comparePositions(a: string, b: string, format: BookFormat): number {
  if (format === 'pdf') {
    const left = Number.parseInt(a, 10)
    const right = Number.parseInt(b, 10)
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right
    return 0
  }
  return compareCfi(a, b)
}

/**
 * Returns a NEW array in reading order (first page to last); annotations at
 * the same position fall back to creation time, oldest first.
 */
export function sortAnnotationsByPosition(
  items: readonly Annotation[],
  format: BookFormat,
): Annotation[] {
  return [...items].sort(
    (a, b) => comparePositions(a.position, b.position, format) || a.createdAt - b.createdAt,
  )
}
