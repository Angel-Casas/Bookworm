import { describe, expect, it } from 'vitest'
import {
  QUICK_TOUR_STEPS,
  TOUR_STEPS,
  nibOffset,
  placeCard,
  spotlightRect,
  stepsFor,
} from '../tour'

const VIEW = { width: 1000, height: 800 }
const CARD = { width: 300, height: 200 }

describe('the steps', () => {
  it('starts on the shelf and ends there', () => {
    // The last stop is back on the library, where "Continue reading" now
    // exists BECAUSE the reader has just been reading.
    expect(TOUR_STEPS[0]?.leg).toBe('shelf')
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]?.leg).toBe('shelf')
  })

  it('goes into the book exactly once and comes back out once', () => {
    const changes = TOUR_STEPS.filter(
      (step, index) => index > 0 && step.leg !== TOUR_STEPS[index - 1]?.leg,
    )
    expect(changes.map((step) => step.leg)).toEqual(['reader', 'shelf'])
  })

  it('has a title and at least one line for every stop', () => {
    const untitled = TOUR_STEPS.filter((step) => !step.titleKey.startsWith('tour.'))
    const silent = TOUR_STEPS.filter((step) => step.bullets.length === 0)
    expect(untitled.map((step) => step.id)).toEqual([])
    expect(silent.map((step) => step.id)).toEqual([])
  })

  it('opens the assistant for one stop, and that stop is inside the book', () => {
    const staged = TOUR_STEPS.filter((step) => step.stage === 'chat')
    expect(staged.map((step) => step.id)).toEqual(['chat'])
    expect(staged.map((step) => step.leg)).toEqual(['reader'])
  })

  it('points at the shut assistant before it points at the open one', () => {
    const order = TOUR_STEPS.map((step) => step.id)
    expect(order.indexOf('assistant')).toBeLessThan(order.indexOf('chat'))
  })

  it('gives every stop its own id', () => {
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length)
  })

  it('names a real message for every line', () => {
    const stray = TOUR_STEPS.flatMap((step) =>
      step.bullets.filter((bullet) => !bullet.key.startsWith('tour.')).map((b) => b.key),
    )
    expect(stray).toEqual([])
  })

  it('borrows the compact shelf only for the steps that point at a card', () => {
    // The lines under a cover exist in one view only; a step that talks about
    // them and does not ask for that view is describing an empty space.
    const borrowing = TOUR_STEPS.filter((step) => step.shelf === 'compact')
    expect(borrowing.map((step) => step.id)).toEqual(['book-card', 'open'])
    expect(borrowing.every((step) => step.leg === 'shelf')).toBe(true)
  })

  it('plays the bookmark only where the bookmark is', () => {
    const demos = TOUR_STEPS.filter((step) => step.demo !== undefined)
    expect(demos.map((step) => step.id)).toEqual(['page'])
  })
})

describe('the quick way round', () => {
  it('is short enough to be worth choosing', () => {
    // The whole argument for it is that it is not the long one. Four stops is
    // the ceiling; past that a reader may as well take the tour.
    expect(QUICK_TOUR_STEPS.length).toBeGreaterThan(0)
    expect(QUICK_TOUR_STEPS.length).toBeLessThanOrEqual(4)
    expect(QUICK_TOUR_STEPS.length).toBeLessThan(TOUR_STEPS.length)
  })

  it('shows the shelf, the assistant, and the key — in that order', () => {
    expect(QUICK_TOUR_STEPS.map((step) => step.id)).toEqual([
      'quick-shelf',
      'quick-chat',
      'quick-key',
    ])
  })

  it('opens the assistant for the stop about it, and settings for the last', () => {
    const staged = QUICK_TOUR_STEPS.filter((step) => step.stage !== undefined)
    expect(staged.map((step) => [step.id, step.stage])).toEqual([
      ['quick-chat', 'chat'],
      ['quick-key', 'settings'],
    ])
    // The assistant only exists inside a book; settings is over the shelf.
    expect(QUICK_TOUR_STEPS.find((step) => step.stage === 'chat')?.leg).toBe('reader')
    expect(QUICK_TOUR_STEPS.find((step) => step.stage === 'settings')?.leg).toBe('shelf')
  })

  it('has a title and at least one line for every stop', () => {
    for (const step of QUICK_TOUR_STEPS) {
      expect(step.titleKey.startsWith('tour.')).toBe(true)
      expect(step.bullets.length).toBeGreaterThan(0)
      expect(step.bullets.every((bullet) => bullet.key.startsWith('tour.'))).toBe(true)
    }
  })

  it('shares no ids with the full tour — the two are told apart by them', () => {
    const full = new Set(TOUR_STEPS.map((step) => step.id))
    expect(QUICK_TOUR_STEPS.filter((step) => full.has(step.id))).toEqual([])
  })

  it('is what stepsFor hands back for the quick path, and only then', () => {
    expect(stepsFor('quick')).toBe(QUICK_TOUR_STEPS)
    expect(stepsFor('full')).toBe(TOUR_STEPS)
  })
})

describe('spotlightRect', () => {
  it('grows the target by its padding', () => {
    expect(spotlightRect({ top: 100, left: 100, width: 200, height: 50 }, 10, VIEW)).toEqual({
      top: 90,
      left: 90,
      width: 220,
      height: 70,
    })
  })

  it('never cuts a hole off the screen', () => {
    // A toolbar flush against the top edge still gets a hole that is on it.
    const hole = spotlightRect({ top: 2, left: -20, width: 200, height: 40 }, 12, VIEW)
    expect(hole.top).toBe(0)
    expect(hole.left).toBe(0)
    expect(hole.left + hole.width).toBeLessThanOrEqual(VIEW.width)
  })

  it('has no size for a target with none', () => {
    const hole = spotlightRect({ top: 400, left: 400, width: 0, height: 0 }, 0, VIEW)
    expect(hole.width).toBe(0)
  })
})

describe('placeCard', () => {
  it('goes below the hole, because that is where the eye already is', () => {
    const place = placeCard({ top: 100, left: 400, width: 200, height: 50 }, CARD, VIEW)
    expect(place.side).toBe('below')
    expect(place.top).toBeGreaterThan(150)
  })

  it('centres itself on the hole across the other axis', () => {
    const place = placeCard({ top: 100, left: 400, width: 200, height: 50 }, CARD, VIEW)
    expect(place.left).toBe(500 - CARD.width / 2)
  })

  it('goes above when there is no room below', () => {
    const place = placeCard({ top: 700, left: 400, width: 200, height: 60 }, CARD, VIEW)
    expect(place.side).toBe('above')
    expect(place.top + CARD.height).toBeLessThanOrEqual(700)
  })

  it('goes to the side when the hole is tall enough to fill the screen', () => {
    const place = placeCard({ top: 10, left: 20, width: 200, height: 780 }, CARD, VIEW)
    expect(place.side).toBe('end')
    expect(place.left).toBeGreaterThanOrEqual(220)
  })

  it('stays on the screen even when the hole is at the edge', () => {
    const place = placeCard({ top: 100, left: 960, width: 40, height: 40 }, CARD, VIEW)
    expect(place.left).toBeGreaterThanOrEqual(12)
    expect(place.left + CARD.width).toBeLessThanOrEqual(VIEW.width - 12)
  })

  it('lies along the bottom when nothing fits', () => {
    // A hole covering the whole screen: the card has to go over it, so it
    // covers the last lines rather than the middle of what it describes.
    const place = placeCard({ top: 0, left: 0, width: 1000, height: 800 }, CARD, VIEW)
    expect(place.side).toBe('bottom')
    expect(place.top + CARD.height).toBeLessThanOrEqual(VIEW.height)
    expect(place.top).toBeGreaterThan(VIEW.height / 2)
  })

  it('centres a step that points at nothing', () => {
    const place = placeCard(null, CARD, VIEW)
    expect(place.side).toBe('centre')
    expect(place.left).toBe((VIEW.width - CARD.width) / 2)
  })
})

describe('nibOffset', () => {
  it('points at the hole’s middle', () => {
    const hole = { top: 100, left: 400, width: 200, height: 50 }
    const card = { top: 164, left: 350, width: 300, height: 200 }
    expect(nibOffset(hole, card, 'below')).toBe(150)
  })

  it('stays on the card when the card has been clamped away', () => {
    // The hole is at the far right; the card could not follow it that far, so
    // the nib runs to the card's own edge rather than off it.
    const hole = { top: 100, left: 960, width: 40, height: 40 }
    const card = { top: 164, left: 688, width: 300, height: 200 }
    const offset = nibOffset(hole, card, 'below')
    expect(offset).toBeGreaterThanOrEqual(12)
    expect(offset).toBeLessThanOrEqual(288)
  })
})
