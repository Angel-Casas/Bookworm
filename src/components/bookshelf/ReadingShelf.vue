<script setup lang="ts">
/**
 * The shelf at the top of the library: every book standing spine-out, the
 * one in front turned to show its cover, with how far in you are under it.
 *
 * It opens on the book you left last, and the books on the go stand beside
 * it, then the rest of the library (lib/librarySort `shelfOrder`) — a shelf of
 * one or two spines read as an empty plank.
 *
 * Every way of moving is a step of ONE book: the arrow keys, the arrow
 * buttons, a wheel or trackpad, and a drag with a mouse or a finger. A click
 * on a spine brings that book to the front; a click on the book in front
 * opens it. Nothing is measured from the DOM: every slot's width follows from
 * the book's thickness, so the row centres on the chosen book without waiting
 * for a layout — and a probe reading the caption never reads a moving box.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ShelfBook from '@/components/bookshelf/ShelfBook.vue'
import SpinePainter from '@/components/bookshelf/SpinePainter.vue'
import { formatProgress } from '@/lib/pagination'
import { spineWidth } from '@/lib/spine'
import type { BookMeta } from '@/lib/types'
import { useI18n } from '@/i18n'
import { useLanguageStore } from '@/stores/language'
import { useSpinesStore } from '@/stores/spines'

const props = defineProps<{ books: readonly BookMeta[] }>()

const { t } = useI18n()
const language = useLanguageStore()
const spines = useSpinesStore()

/* ------------------------------------------------------------- geometry */

const narrow = ref(false)
const BOOK_H = computed(() => (narrow.value ? 220 : 260))
const COVER_W = computed(() => Math.round((BOOK_H.value * 2) / 3))
const GAP = 3
/** How far the book in front turns: -90 would show the cover flat, this leaves the spine in view. */
const TURN = 72
const PULL = 70
const PERSPECTIVE = 1400

const widths = computed(() => props.books.map((book) => spineWidth(book.id, null)))

function frontSlot(d: number): number {
  const a = ((90 - TURN) * Math.PI) / 180
  const scale = PERSPECTIVE / (PERSPECTIVE - PULL)
  return (COVER_W.value * Math.cos(a) + d * Math.sin(a)) * scale + 36
}

/* ---------------------------------------------------------- which book */

/**
 * The book in front, by id so it survives books arriving and leaving. Null
 * means "whichever leads": the shelf in its resting state follows the book
 * left last, so finishing it hands the front to the next one still going,
 * while a reader who has moved along keeps the book they moved to.
 */
const chosenId = ref<string | null>(null)
const index = computed(() => {
  const at = props.books.findIndex((book) => book.id === chosenId.value)
  return at === -1 ? 0 : at
})
const chosen = computed<BookMeta | undefined>(() => props.books[index.value])

function go(next: number): void {
  const clamped = Math.min(Math.max(0, next), props.books.length - 1)
  chosenId.value = clamped === 0 ? null : (props.books[clamped]?.id ?? null)
}
function step(delta: number): void {
  go(index.value + delta)
}

const viewport = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)

const slots = computed(() =>
  widths.value.map((d, i) => (i === index.value ? frontSlot(d) : d + GAP)),
)
const offset = computed(() => {
  const before = slots.value.slice(0, index.value).reduce((sum, w) => sum + w, 0)
  return viewportWidth.value / 2 - before - (slots.value[index.value] ?? 0) / 2
})

/* ------------------------------------------------------------- moving */

const WHEEL_STEP = 46
const DRAG_STEP = 38
let wheel = 0
function onWheel(event: WheelEvent): void {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  // A vertical wheel only moves the shelf when it is the shelf being pointed
  // at with no horizontal intent elsewhere; the page still scrolls past it at
  // either end, so a reader scrolling down the library is not trapped.
  const atEnd =
    (delta < 0 && index.value === 0) || (delta > 0 && index.value === props.books.length - 1)
  if (!delta || atEnd) return
  event.preventDefault()
  wheel += delta
  while (Math.abs(wheel) >= WHEEL_STEP) {
    const direction = Math.sign(wheel)
    step(direction)
    wheel -= direction * WHEEL_STEP
  }
}

/**
 * Drag, for every pointer. `touch-action: pan-y` on the viewport leaves the
 * page's vertical scroll to the browser and gives the horizontal gesture to
 * us, and `pointercancel` ends a drag the browser took back (see LESSONS: a
 * drag that works with a mouse is not a drag that works).
 */
let drag: { x: number; id: number } | null = null
const dragged = ref(false)
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  drag = { x: event.clientX, id: event.pointerId }
  dragged.value = false
}
function onPointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return
  const dx = event.clientX - drag.x
  if (Math.abs(dx) < DRAG_STEP) return
  if (!dragged.value) viewport.value?.setPointerCapture(event.pointerId)
  dragged.value = true
  // The row follows the hand: pulling it left brings the next book in.
  step(dx < 0 ? 1 : -1)
  drag.x = event.clientX
}
function onPointerEnd(event: PointerEvent): void {
  if (viewport.value?.hasPointerCapture(event.pointerId)) {
    viewport.value.releasePointerCapture(event.pointerId)
  }
  drag = null
}

/** A drag that moved is not a click; a click on a spine chooses, on the front book opens. */
function onClick(event: MouseEvent): void {
  if (dragged.value) {
    dragged.value = false
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const box = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
  if (!box) return
  const at = Number(box.dataset.index)
  if (at !== index.value) {
    event.preventDefault()
    event.stopPropagation()
    go(at)
  }
}

function focusFront(): void {
  viewport.value
    ?.querySelector<HTMLElement>(`[data-index="${index.value}"]`)
    ?.focus({ preventScroll: true })
}

function onKey(event: KeyboardEvent): void {
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, PageDown: 5, PageUp: -5 }
  if (event.key in moves) step(moves[event.key]!)
  else if (event.key === 'Home') go(0)
  else if (event.key === 'End') go(props.books.length - 1)
  else return
  event.preventDefault()
  requestAnimationFrame(focusFront)
}

/* ------------------------------------------------------------ the rest */

let observer: ResizeObserver | null = null
let query: MediaQueryList | null = null
const onQuery = () => (narrow.value = query?.matches ?? false)
onMounted(() => {
  query = window.matchMedia('(max-width: 600px)')
  onQuery()
  query.addEventListener('change', onQuery)
  observer = new ResizeObserver(([entry]) => {
    viewportWidth.value = entry?.contentRect.width ?? 0
  })
  if (viewport.value) observer.observe(viewport.value)
  void spines.load()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  query?.removeEventListener('change', onQuery)
})

// Spines are made for the books in view first, then the rest of the shelf.
watch(
  () => [props.books, index.value] as const,
  ([books, at]) => {
    const near = books.slice(Math.max(0, at - 12), at + 12)
    void spines.makeFor(near).then(() => spines.makeFor(books))
  },
  { immediate: true },
)

const inProgress = computed(
  () =>
    chosen.value != null && chosen.value.finishedAt == null && chosen.value.lastOpenedAt != null,
)
const anyInProgress = computed(() =>
  props.books.some((book) => book.finishedAt == null && book.lastOpenedAt != null),
)

/** null until the book has been opened long enough to count its pages. */
const fraction = computed(() => {
  const value = chosen.value?.progress
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
})
const percentLabel = computed(() => {
  if (fraction.value !== null) return formatProgress(fraction.value, language.code)
  return inProgress.value ? t('continue.justOpened') : t('continue.notStarted')
})

/** The bar sweeps to its value: from empty on arrival, and from book to book. */
const drawn = ref(0)
watch(
  fraction,
  (value) => {
    drawn.value = 0
    requestAnimationFrame(() => (drawn.value = value ?? 0))
  },
  { immediate: true },
)
</script>

<template>
  <section
    class="reading-shelf"
    data-testid="reading-shelf"
    :aria-label="anyInProgress ? t('continue.eyebrow') : t('continue.shelf')"
  >
    <!-- Gilded like the bookplate under it: the words between two rules that
         end in a lozenge. -->
    <h2 class="heading">
      <span class="rule" aria-hidden="true"></span>
      <span class="lozenge" aria-hidden="true"></span>
      <span class="words">{{ anyInProgress ? t('continue.eyebrow') : t('continue.shelf') }}</span>
      <span class="lozenge" aria-hidden="true"></span>
      <span class="rule" aria-hidden="true"></span>
    </h2>

    <div class="stage" :style="{ '--book-h': `${BOOK_H}px` }">
      <button
        type="button"
        class="arrow prev"
        :aria-label="t('continue.previous')"
        :disabled="index === 0"
        @click="step(-1)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5" /></svg>
      </button>
      <div
        ref="viewport"
        class="viewport"
        :aria-label="t('continue.shelfHint')"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
        @click.capture="onClick"
        @keydown="onKey"
      >
        <ul class="track" :style="{ transform: `translateX(${offset}px)` }">
          <li
            v-for="(book, i) in books"
            :key="book.id"
            class="slot"
            :class="{ front: i === index }"
            :style="{ width: `${slots[i]}px` }"
          >
            <ShelfBook
              :book="book"
              :index="i"
              :chosen="i === index"
              :width="widths[i]!"
              :height="BOOK_H"
              :cover-width="COVER_W"
              :made="spines.madeFor(book.id)"
              :painted="spines.paintedFor(book.id)"
            />
          </li>
        </ul>
      </div>
      <button
        type="button"
        class="arrow next"
        :aria-label="t('continue.next')"
        :disabled="index === books.length - 1"
        @click="step(1)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 3 5 5-5 5" /></svg>
      </button>
    </div>

    <div v-if="chosen" class="caption">
      <h3 class="title" :data-testid="inProgress ? 'continue-title' : undefined" aria-live="polite">
        {{ chosen.title }}
      </h3>
      <p class="author">{{ chosen.author ?? '' }}</p>
      <div class="meter">
        <span
          class="rail"
          :class="{ unknown: fraction === null }"
          role="progressbar"
          :data-testid="inProgress ? 'continue-progress' : undefined"
          :aria-label="t('continue.progress')"
          :aria-valuenow="fraction === null ? undefined : Math.round(fraction * 100)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuetext="fraction === null ? t('continue.uncounted') : percentLabel"
        >
          <span class="fill" :style="{ width: `${drawn * 100}%` }"></span>
        </span>
        <span class="percent" :data-testid="inProgress ? 'continue-percent' : undefined">{{
          percentLabel
        }}</span>
      </div>
      <RouterLink
        class="open"
        :data-testid="inProgress ? 'continue-reading' : 'shelf-open'"
        :to="{ name: 'reader', params: { id: chosen.id } }"
      >
        {{ chosen.lastOpenedAt != null ? t('continue.resume') : t('continue.start') }}
      </RouterLink>
      <SpinePainter :book="chosen" :shelf="books" />
    </div>
  </section>
</template>

<style scoped>
.reading-shelf {
  --ease-turn: cubic-bezier(0.3, 0.7, 0.1, 1);
  margin: 0 0 2rem;
}
.heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin: 0.4rem 0 0.2rem;
  font-weight: 400;
}
.rule {
  flex: 1 1 auto;
  max-width: 10rem;
  height: 1px;
  background: var(--hair);
}
.lozenge {
  flex: none;
  width: 6px;
  height: 6px;
  border: 1px solid var(--gold);
  transform: rotate(45deg);
}
.words {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.95rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--gold);
  white-space: nowrap;
  /* Letter-spacing trails the last letter too; give it back so the words sit
     in the true middle between the lozenges. */
  margin-inline-end: -0.3em;
}
@media (max-width: 600px) {
  .words {
    font-size: 0.8rem;
    letter-spacing: 0.22em;
    margin-inline-end: -0.22em;
  }
}
.stage {
  position: relative;
  direction: ltr;
}
.viewport {
  /* The row is laid out by arithmetic from its left edge, so it stays left to
     right in every language — and the arrow keys and buttons with it. */
  direction: ltr;
  position: relative;
  height: calc(var(--book-h) + 70px);
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}
.viewport:active {
  cursor: grabbing;
}
.track {
  list-style: none;
  margin: 0;
  padding: 0;
  position: absolute;
  top: 40px;
  left: 0;
  display: flex;
  align-items: flex-end;
  transition: transform 0.65s var(--ease-turn);
}
.slot {
  position: relative;
  flex: none;
  height: var(--book-h);
  transition: width 0.65s var(--ease-turn);
}
.slot.front {
  z-index: 2;
}
.arrow {
  position: absolute;
  top: calc(40px + var(--book-h) / 2);
  transform: translateY(-50%);
  z-index: 3;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  border: 1px solid var(--hair);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  color: var(--gold);
  cursor: pointer;
  /* The app's buttons carry padding and letter-spacing for words; an arrow
     is neither, and a text glyph sits on the baseline, not in the middle.
     An icon drawn on its own centre, in a grid, is centred by construction. */
  padding: 0;
  display: grid;
  place-items: center;
}
.arrow svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.arrow:disabled {
  opacity: 0.3;
  cursor: default;
}
.arrow.prev {
  left: 0.5rem;
}
.arrow.next {
  right: 0.5rem;
}
/* A finger swipes; the arrows are for a mouse. */
@media (hover: none) {
  .arrow {
    display: none;
  }
}

.caption {
  text-align: center;
  max-width: 28rem;
  margin: 0 auto;
  padding: 0 1rem;
}
.title {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 1.35rem;
  line-height: 1.2;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.author {
  font-style: italic;
  color: var(--text-dim);
  margin: 0.1rem 0 0.7rem;
  min-height: 1.3em;
}
.meter {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  max-width: 16rem;
  margin: 0 auto 0.8rem;
}
.rail {
  flex: 1 1 auto;
  min-width: 0;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-faint) 30%, transparent);
  overflow: hidden;
}
/* A book whose pages have not been counted gets a faint rail and no claim:
   an empty bar would say "you have read none of it", which is not true. */
.rail.unknown {
  background: repeating-linear-gradient(
    90deg,
    color-mix(in srgb, var(--text-faint) 30%, transparent) 0 4px,
    transparent 4px 8px
  );
}
.fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gold-deep), var(--gold));
  transition: width 0.6s var(--ease-wipe);
}
.percent {
  flex: none;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.open {
  display: inline-block;
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gold);
  background: none;
  border: 1px solid var(--gold);
  border-radius: 2px;
  padding: 0.5rem 1.1rem;
  cursor: pointer;
}
.open:hover,
.open:focus-visible {
  background: var(--gold);
  color: var(--gold-ink);
}

@media (prefers-reduced-motion: reduce) {
  .track,
  .slot,
  .fill {
    transition: none;
  }
}
</style>
