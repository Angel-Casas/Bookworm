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

/**
 * A control drawn INTO a line of the card, in the same ink as the button it
 * names.
 *
 * A sentence that opens "the ranked bars sort the shelf" asks the reader to
 * translate a description back into a shape, then hunt that shape in the row
 * behind the card. The glyph skips both steps, and it is shorter — which is
 * what buys the room for the sentence to say something the icon cannot.
 * `spread`, `theme`, `daylight`, `grid` and `archive` come in more than one
 * state, and a line about a control that toggles shows every face of it.
 */
export type TourGlyph =
  | 'plus'
  | 'grid-big'
  | 'grid-compact'
  | 'search'
  | 'rank'
  | 'archive-out'
  | 'archive-in'
  | 'support'
  | 'lang'
  | 'theme-dark'
  | 'theme-light'
  | 'settings'
  | 'spread-single'
  | 'spread-double'
  | 'spread-scroll'
  | 'type'
  | 'focus'
  | 'daylight-light'
  | 'daylight-dark'
  | 'inkwell'
  | 'ribbon'
  | 'lamp'
  | 'gloss'
  | 'contents'

/** One line under the card's title: what it says, and the controls it is about. */
export interface TourBullet {
  key: string
  /** Drawn before the words, ahead of a thin dash that keeps them apart. */
  icons?: readonly TourGlyph[]
}

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
  bullets: readonly TourBullet[]
  /** Breathing room around the target, in px. */
  pad?: number
  /**
   * Something the app must be showing for this step to make sense. The
   * assistant is a panel, not a button: explaining it while it is shut is
   * describing a room from outside the door, so the step that explains it
   * opens it, and every other step closes it again. Settings is the same
   * argument: the three steps that get a reader a key are IN there, and a
   * tour that points at the door instead of the instructions has explained
   * nothing.
   */
  stage?: 'chat' | 'settings'
  /**
   * The shelf must be showing covers WITH their details for this step, because
   * the step talks about the details. A reader whose shelf is set to big
   * covers would otherwise be pointed at text that is not on their screen.
   * The reader's own setting is put back when the tour ends.
   */
  shelf?: 'compact'
  /**
   * A small moving illustration inside the card, for a gesture that a
   * sentence describes badly — pulling a chain, a corner folding over.
   */
  demo?: 'bookmark'
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
    bullets: [{ key: 'tour.welcome.b1' }, { key: 'tour.welcome.b2' }, { key: 'tour.welcome.b3' }],
  },
  {
    id: 'shelf-controls',
    leg: 'shelf',
    target: '.header-actions',
    titleKey: 'tour.controls.title',
    bullets: [
      { key: 'tour.controls.b1', icons: ['plus'] },
      { key: 'tour.controls.b2', icons: ['grid-big', 'grid-compact'] },
      { key: 'tour.controls.b3', icons: ['search'] },
      { key: 'tour.controls.b4', icons: ['rank'] },
      { key: 'tour.controls.b5', icons: ['archive-out', 'archive-in'] },
    ],
    pad: 10,
  },
  {
    id: 'book-card',
    leg: 'shelf',
    target: 'article.book-card',
    titleKey: 'tour.card.title',
    bullets: [{ key: 'tour.card.b1' }, { key: 'tour.card.b2' }, { key: 'tour.card.b3' }],
    pad: 8,
    shelf: 'compact',
  },
  {
    id: 'nav',
    leg: 'shelf',
    target: '.nav-actions',
    titleKey: 'tour.nav.title',
    bullets: [
      { key: 'tour.nav.b1', icons: ['support'] },
      { key: 'tour.nav.b2', icons: ['lang'] },
      { key: 'tour.nav.b3', icons: ['theme-dark', 'theme-light'] },
      { key: 'tour.nav.b4', icons: ['settings'] },
    ],
    pad: 8,
  },
  {
    id: 'open',
    leg: 'shelf',
    target: 'article.book-card',
    titleKey: 'tour.open.title',
    bullets: [{ key: 'tour.open.b1' }],
    pad: 8,
    shelf: 'compact',
  },
  {
    id: 'reader-toolbar',
    leg: 'reader',
    target: '.reader-header',
    titleKey: 'tour.toolbar.title',
    bullets: [
      { key: 'tour.toolbar.b1', icons: ['spread-single', 'spread-double', 'spread-scroll'] },
      { key: 'tour.toolbar.b2', icons: ['type'] },
      { key: 'tour.toolbar.b3', icons: ['focus'] },
      { key: 'tour.toolbar.b4', icons: ['daylight-light', 'daylight-dark'] },
      { key: 'tour.toolbar.b5', icons: ['inkwell'] },
      { key: 'tour.toolbar.b6', icons: ['ribbon', 'search'] },
    ],
    pad: 10,
  },
  {
    id: 'page',
    leg: 'reader',
    target: '[data-testid=add-bookmark]',
    titleKey: 'tour.page.title',
    bullets: [
      { key: 'tour.page.b1', icons: ['lamp'] },
      { key: 'tour.page.b2' },
      { key: 'tour.page.b3' },
    ],
    pad: 14,
    demo: 'bookmark',
  },
  {
    id: 'selection',
    leg: 'reader',
    target: '[data-testid=epub-container]',
    titleKey: 'tour.selection.title',
    bullets: [
      { key: 'tour.selection.b1', icons: ['inkwell'] },
      { key: 'tour.selection.b2', icons: ['gloss'] },
      { key: 'tour.selection.b3' },
    ],
    pad: 6,
  },
  {
    id: 'pager',
    leg: 'reader',
    target: '.reader-stage .controls',
    titleKey: 'tour.pager.title',
    bullets: [
      { key: 'tour.pager.b1' },
      { key: 'tour.pager.b2', icons: ['contents'] },
      { key: 'tour.pager.b3' },
    ],
    pad: 10,
  },
  {
    id: 'assistant',
    leg: 'reader',
    target: '[data-testid=chat-toggle]',
    titleKey: 'tour.assistant.title',
    bullets: [
      { key: 'tour.assistant.b1' },
      { key: 'tour.assistant.b2' },
      { key: 'tour.assistant.b3' },
    ],
    pad: 10,
  },
  {
    id: 'chat',
    leg: 'reader',
    target: '[data-testid=chat-panel]',
    titleKey: 'tour.chat.title',
    bullets: [
      { key: 'tour.chat.b1' },
      { key: 'tour.chat.b2' },
      { key: 'tour.chat.b3' },
      { key: 'tour.chat.b4' },
      { key: 'tour.chat.b5' },
    ],
    pad: 6,
    stage: 'chat',
  },
  {
    id: 'done',
    leg: 'shelf',
    target: '[data-testid=continue-reading]',
    titleKey: 'tour.done.title',
    bullets: [{ key: 'tour.done.b1' }, { key: 'tour.done.b2' }],
    pad: 8,
  },
] as const

/**
 * The short way round.
 *
 * The full tour is twelve stops because the app has twelve rows of controls
 * worth naming, and a reader who wants to READ SOMETHING TONIGHT does not owe
 * us twelve. This one answers the only three questions that stand between a
 * newcomer and a working app: where the books are, what the assistant is, and
 * what it needs before it will say a word. Everything else is discoverable by
 * pressing it; a key is not.
 *
 * It ends inside settings rather than pointing at the door to it, because the
 * last step is the one with something to DO — the three-step block it lands on
 * is the instruction, and the reader is already there when the tour lets go.
 */
export const QUICK_TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'quick-shelf',
    leg: 'shelf',
    target: '[data-testid=shelf]',
    titleKey: 'tour.quick.shelf.title',
    bullets: [
      { key: 'tour.quick.shelf.b1', icons: ['plus'] },
      { key: 'tour.quick.shelf.b2' },
      { key: 'tour.quick.shelf.b3' },
    ],
    pad: 10,
    shelf: 'compact',
  },
  {
    id: 'quick-chat',
    leg: 'reader',
    target: '[data-testid=chat-panel]',
    titleKey: 'tour.quick.chat.title',
    bullets: [
      { key: 'tour.quick.chat.b1' },
      { key: 'tour.quick.chat.b2' },
      { key: 'tour.quick.chat.b3' },
    ],
    pad: 6,
    stage: 'chat',
  },
  {
    id: 'quick-key',
    leg: 'shelf',
    target: '[data-testid=key-setup]',
    titleKey: 'tour.quick.key.title',
    bullets: [
      { key: 'tour.quick.key.b1' },
      { key: 'tour.quick.key.b2' },
      { key: 'tour.quick.key.b3' },
      { key: 'tour.quick.key.b4' },
    ],
    pad: 10,
    stage: 'settings',
  },
] as const

/**
 * Which walk a reader asked for. Chosen once, on the first card, and then
 * never asked about again — settings runs the full one, which is what a reader
 * who comes back for a tour is coming back for.
 */
export type TourPath = 'full' | 'quick'

export function stepsFor(path: TourPath): readonly TourStep[] {
  return path === 'quick' ? QUICK_TOUR_STEPS : TOUR_STEPS
}

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
export function placeCard(hole: Rect | null, card: Size, viewport: Size, gap = 14): CardPlacement {
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
