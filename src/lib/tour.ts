/**
 * The tour: what it points at, in what order, and where the card goes.
 *
 * A first-time reader lands on an empty shelf full of small round icons with
 * no words on them. Every one of them is obvious once you know, and none of
 * them is obvious before — so the app says what they are, once, and then never
 * again.
 *
 * Two rules shape the steps below. It points at ROWS, not buttons: a toolbar
 * explained one icon at a time is nine interruptions where one would do, and
 * the bullets under the card can name all nine in the time it takes to read
 * them. And it points at things that are really there: a step whose target is
 * missing is skipped rather than shown pointing at nothing, which is what lets
 * the same list serve a phone, a desktop, and a book that happens to be a PDF.
 *
 * Everything here is pure — the steps, and the geometry that puts a card
 * beside a hole without either falling off the screen.
 */

export type TourLeg = 'shelf' | 'reader'

export interface TourStep {
  id: string
  leg: TourLeg
  /**
   * What to spotlight, as a CSS selector. Null means a card in the middle of
   * the screen with nothing cut out of the dark — for the steps that are
   * about the app rather than about a control.
   */
  target: string | null
  titleKey: string
  /** One line each, under the title. A row is explained by its bullets. */
  bulletKeys: readonly string[]
  /** Breathing room around the target, in px. */
  pad?: number
  /**
   * Something the app must be showing for this step to make sense. The
   * assistant is a panel, not a button: explaining it while it is shut is
   * describing a room from outside the door, so the step that explains it
   * opens it, and every other step closes it again.
   */
  stage?: 'chat'
}

/**
 * The tour, in order. The shelf leg runs on the library; the reader leg runs
 * inside the sample book; the last step lands back on the shelf, where
 * "Continue reading" now exists because the reader has just been reading.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    leg: 'shelf',
    target: null,
    titleKey: 'tour.welcome.title',
    bulletKeys: ['tour.welcome.b1', 'tour.welcome.b2', 'tour.welcome.b3'],
  },
  {
    id: 'shelf-controls',
    leg: 'shelf',
    target: '.header-actions',
    titleKey: 'tour.controls.title',
    bulletKeys: [
      'tour.controls.b1',
      'tour.controls.b2',
      'tour.controls.b3',
      'tour.controls.b4',
      'tour.controls.b5',
    ],
    pad: 10,
  },
  {
    id: 'book-card',
    leg: 'shelf',
    target: 'article.book-card',
    titleKey: 'tour.card.title',
    bulletKeys: ['tour.card.b1', 'tour.card.b2', 'tour.card.b3'],
    pad: 8,
  },
  {
    id: 'nav',
    leg: 'shelf',
    target: '.nav-actions',
    titleKey: 'tour.nav.title',
    bulletKeys: ['tour.nav.b1', 'tour.nav.b2', 'tour.nav.b3', 'tour.nav.b4'],
    pad: 8,
  },
  {
    id: 'open',
    leg: 'shelf',
    target: 'article.book-card',
    titleKey: 'tour.open.title',
    bulletKeys: ['tour.open.b1'],
    pad: 8,
  },
  {
    id: 'reader-toolbar',
    leg: 'reader',
    target: '.reader-header',
    titleKey: 'tour.toolbar.title',
    bulletKeys: [
      'tour.toolbar.b1',
      'tour.toolbar.b2',
      'tour.toolbar.b3',
      'tour.toolbar.b4',
      'tour.toolbar.b5',
      'tour.toolbar.b6',
    ],
    pad: 10,
  },
  {
    id: 'page',
    leg: 'reader',
    target: '[data-testid=add-bookmark]',
    titleKey: 'tour.page.title',
    bulletKeys: ['tour.page.b1', 'tour.page.b2', 'tour.page.b3'],
    pad: 14,
  },
  {
    id: 'selection',
    leg: 'reader',
    target: '[data-testid=epub-container]',
    titleKey: 'tour.selection.title',
    bulletKeys: ['tour.selection.b1', 'tour.selection.b2', 'tour.selection.b3'],
    pad: 6,
  },
  {
    id: 'pager',
    leg: 'reader',
    target: '.reader-stage .controls',
    titleKey: 'tour.pager.title',
    bulletKeys: ['tour.pager.b1', 'tour.pager.b2', 'tour.pager.b3'],
    pad: 10,
  },
  {
    id: 'assistant',
    leg: 'reader',
    target: '[data-testid=chat-toggle]',
    titleKey: 'tour.assistant.title',
    bulletKeys: ['tour.assistant.b1', 'tour.assistant.b2', 'tour.assistant.b3'],
    pad: 10,
  },
  {
    id: 'chat',
    leg: 'reader',
    target: '[data-testid=chat-panel]',
    titleKey: 'tour.chat.title',
    bulletKeys: [
      'tour.chat.b1',
      'tour.chat.b2',
      'tour.chat.b3',
      'tour.chat.b4',
      'tour.chat.b5',
    ],
    pad: 6,
    stage: 'chat',
  },
  {
    id: 'done',
    leg: 'shelf',
    target: '[data-testid=continue-reading]',
    titleKey: 'tour.done.title',
    bulletKeys: ['tour.done.b1', 'tour.done.b2'],
    pad: 8,
  },
] as const

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * The hole to cut in the dark: the target's box, grown by its padding and kept
 * inside the screen. A target half off-screen still gets a hole that is on it.
 */
export function spotlightRect(target: Rect, pad: number, viewport: Size): Rect {
  const top = Math.max(0, target.top - pad)
  const left = Math.max(0, target.left - pad)
  const right = Math.min(viewport.width, target.left + target.width + pad)
  const bottom = Math.min(viewport.height, target.top + target.height + pad)
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/** Where the card ended up. 'centre' is for a step that points at nothing;
 *  'bottom' is the last resort, when the hole leaves no room anywhere. */
export type CardSide = 'below' | 'above' | 'start' | 'end' | 'centre' | 'bottom'

export interface CardPlacement {
  top: number
  left: number
  /** Which side of the hole the card ended up on — the nib points back. */
  side: CardSide
}

const MARGIN = 12

/**
 * Put the card beside the hole.
 *
 * Below first, because that is where a reader's eye already is after looking
 * at the thing being explained; then above; then to either side; and if none
 * of those fit, along the bottom of the screen — which covers the least of
 * what is being explained, and is honest about there being no room rather
 * than shoving the card half off the edge.
 */
export function placeCard(
  hole: Rect | null,
  card: Size,
  viewport: Size,
  gap = 14,
): CardPlacement {
  const centre = (): CardPlacement => ({
    top: Math.max(MARGIN, (viewport.height - card.height) / 2),
    left: Math.max(MARGIN, (viewport.width - card.width) / 2),
    side: 'centre',
  })
  if (!hole) return centre()

  /**
   * Nothing fits. The card has to go over the hole, so it lies along the
   * BOTTOM rather than through the middle: a step whose target is the whole
   * page is a step about the page, and covering its last lines leaves far
   * more of it readable than covering its heart.
   */
  const bottom = (): CardPlacement => ({
    top: Math.max(MARGIN, viewport.height - card.height - MARGIN),
    left: Math.max(MARGIN, (viewport.width - card.width) / 2),
    side: 'bottom',
  })

  const clampX = (value: number) =>
    Math.min(Math.max(MARGIN, value), Math.max(MARGIN, viewport.width - card.width - MARGIN))
  const clampY = (value: number) =>
    Math.min(Math.max(MARGIN, value), Math.max(MARGIN, viewport.height - card.height - MARGIN))

  const holeBottom = hole.top + hole.height
  const holeRight = hole.left + hole.width
  // Centred on the hole along the other axis, so the card reads as belonging
  // to it rather than merely being near it.
  const acrossX = clampX(hole.left + hole.width / 2 - card.width / 2)
  const acrossY = clampY(hole.top + hole.height / 2 - card.height / 2)

  if (holeBottom + gap + card.height + MARGIN <= viewport.height) {
    return { top: holeBottom + gap, left: acrossX, side: 'below' }
  }
  if (hole.top - gap - card.height >= MARGIN) {
    return { top: hole.top - gap - card.height, left: acrossX, side: 'above' }
  }
  if (holeRight + gap + card.width + MARGIN <= viewport.width) {
    return { top: acrossY, left: holeRight + gap, side: 'end' }
  }
  if (hole.left - gap - card.width >= MARGIN) {
    return { top: acrossY, left: hole.left - gap - card.width, side: 'start' }
  }
  return bottom()
}

/** Where the nib should sit along the card's edge, so it points at the hole's
 *  middle even after the card has been clamped away from it. */
export function nibOffset(hole: Rect, card: Rect, side: CardSide): number {
  if (side === 'below' || side === 'above') {
    const middle = hole.left + hole.width / 2
    return Math.min(Math.max(12, middle - card.left), Math.max(12, card.width - 12))
  }
  const middle = hole.top + hole.height / 2
  return Math.min(Math.max(12, middle - card.top), Math.max(12, card.height - 12))
}
