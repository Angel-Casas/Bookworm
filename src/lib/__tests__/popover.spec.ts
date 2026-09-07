import { describe, expect, it } from 'vitest'
import { dropFrom, shiftIntoView, type Bounds } from '../popover'

const box = (left: number, right: number, top = 0, bottom = 0): Bounds => ({
  left,
  right,
  top,
  bottom,
})

describe('dropFrom', () => {
  const opts = { topInset: 88, bottomMargin: 16, wanted: 480, min: 200 }

  it('opens downward when there is room below', () => {
    // A trigger near the top of a tall window.
    expect(dropFrom(box(0, 100, 120, 160), 900, opts)).toEqual({ up: false, maxHeight: 480 })
  })

  it('opens upward when below is tight and above is roomier', () => {
    // A trigger at the foot of the window — the assistant's toolbar.
    const drop = dropFrom(box(0, 100, 800, 840), 900, opts)
    expect(drop.up).toBe(true)
    expect(drop.maxHeight).toBe(480)
  })

  it('takes only the room it actually has', () => {
    // 300px of window above the trigger, minus the fixed nav.
    expect(dropFrom(box(0, 100, 300, 340), 380, opts).maxHeight).toBe(212)
  })

  it('does not flip for a few pixels', () => {
    // Slightly more room above, but below is already generous.
    expect(dropFrom(box(0, 100, 500, 520), 1100, opts).up).toBe(false)
  })

  it('never collapses to nothing, however cramped', () => {
    expect(dropFrom(box(0, 100, 40, 90), 120, opts).maxHeight).toBe(200)
  })
})

describe('shiftIntoView', () => {
  it('leaves a popover that already fits where it is', () => {
    expect(shiftIntoView(box(20, 300), 390)).toBe(0)
  })

  it('slides a right-aligned sheet back onto a phone screen', () => {
    // The real case: a 358px sheet right-aligned to a trigger ending at 331.
    expect(shiftIntoView(box(-27, 331), 390)).toBe(35)
  })

  it('pulls a left-aligned sheet back from the right edge', () => {
    expect(shiftIntoView(box(100, 458), 390)).toBe(-76)
  })

  it('pins a popover wider than the window to the left, where reading starts', () => {
    expect(shiftIntoView(box(-40, 460), 390)).toBe(48)
  })

  it('respects the margin it is given', () => {
    expect(shiftIntoView(box(-27, 331), 390, 0)).toBe(27)
  })
})
