<script setup lang="ts">
/**
 * The tour, on screen: a hole in the dark and a card beside it.
 *
 * The dimming is four panels around the hole rather than one box with a mask.
 * A mask would be shorter to write and would need `backdrop-filter` or
 * `clip-path` to behave identically in every browser the app runs in; four
 * rectangles are four rectangles everywhere, they animate cheaply, and the
 * hole is genuinely empty — the thing being explained is not being looked at
 * through anything.
 *
 * Nothing under the dark is clickable while the tour runs. That is the point:
 * a reader following a tour should not be able to half-press a control and
 * land somewhere the next step does not expect.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { nibOffset, placeCard, spotlightRect, type CardSide, type Rect } from '@/lib/tour'
import { isTextEntryTarget } from '@/lib/keyboard'
import { useI18n, type MessageKey } from '@/i18n'
import { useTourStore } from '@/stores/tour'
import { useUiStore } from '@/stores/ui'

const tour = useTourStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const cardRef = ref<HTMLDivElement | null>(null)
/**
 * Where the light is, always — never null.
 *
 * The dark is four panels tiled around this rectangle, and four panels only
 * travel smoothly if they are the SAME four panels from one step to the next.
 * A hole that came and went took the panels with it: three of them were torn
 * down and rebuilt while the fourth grew to cover the screen, which is the
 * blackout between steps, and the reverse of it is the flash of an undimmed
 * page. So a step with nothing to point at shuts the iris to a point instead
 * of removing it, and the same four rectangles are on screen the whole time.
 */
const spot = ref<Rect>({
  top: window.innerHeight / 2,
  left: window.innerWidth / 2,
  width: 0,
  height: 0,
})
/** Whether the iris is open: the ring and its pulse follow this, the dark
 *  does not. */
const lit = ref(false)
const hole = computed<Rect | null>(() => (lit.value ? spot.value : null))
const card = ref<{ top: number; left: number; side: CardSide }>({
  top: 0,
  left: 0,
  side: 'centre',
})
const nib = ref(0)
/** Nothing is drawn until the target has been found and measured — a card that
 *  appears at 0,0 and then jumps is worse than one that appears late. */
const placed = ref(false)
/** True once the card has been placed for the first time. Before that it is
 *  hidden and fades in; after it, it TRAVELS to each new position rather than
 *  blinking out and in, which is one flicker fewer per step. */
const settled = ref(false)
/**
 * Set when a step arrives, cleared when the card has been placed and focused.
 *
 * The book renders in an iframe with its own keyboard listeners, and a reader
 * who clicked the page has left focus in there, where the tour's keys cannot
 * reach it. Taking focus onto the card at each step keeps the keyboard in the
 * one place that is actually listening — and tells a screen reader that the
 * card is the thing that just changed.
 */
const wantFocus = ref(false)

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

/** How long to keep looking for a target that is not there yet: a book has to
 *  render, a route has to settle. Past this the step is skipped. */
const HUNT_MS = 2500
const HUNT_EVERY_MS = 100
let huntTimer = 0

/** Shut the iris where it stands, so the dark closes over the last thing it
 *  was showing rather than appearing from nowhere. */
function shut(): void {
  const was = spot.value
  spot.value = {
    top: was.top + was.height / 2,
    left: was.left + was.width / 2,
    width: 0,
    height: 0,
  }
  lit.value = false
}

function measure(): void {
  const step = tour.step
  if (!step) return
  if (step.target === null) {
    shut()
    layout()
    return
  }
  const element = document.querySelector(step.target)
  if (!element) return
  const box = element.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return
  spot.value = spotlightRect(
    { top: box.top, left: box.left, width: box.width, height: box.height },
    step.pad ?? 8,
    viewport(),
  )
  lit.value = true
  layout()
}

function layout(): void {
  void nextTick(() => {
    const element = cardRef.value
    if (!element) return
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    card.value = placeCard(hole.value, size, viewport())
    nib.value = hole.value
      ? nibOffset(hole.value, { ...card.value, ...size }, card.value.side)
      : 0
    placed.value = true
    settled.value = true
    if (wantFocus.value) {
      wantFocus.value = false
      element.focus({ preventScroll: true })
    }
  })
}

/**
 * Measure again once the app has stopped moving.
 *
 * A step can change the shape of the page it is pointing at — the assistant
 * opens, a panel takes half the reader — and the first measurement catches
 * that halfway. A second pass a moment later costs nothing when nothing has
 * moved, because the light travels to the same place it is already in.
 */
let settleTimer = 0
function settle(): void {
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(measure, 280)
}

/**
 * Find the step's target, waiting for it if it is on its way. A step whose
 * target never turns up is skipped rather than shown pointing at nothing —
 * which is what lets one list of steps serve a phone and a desktop, where not
 * every control exists.
 */
function hunt(): void {
  window.clearInterval(huntTimer)
  const step = tour.step
  if (!step) return
  placed.value = false
  wantFocus.value = true
  // The light STAYS where it was until the next target has been found. Putting
  // it out in between is the flash: the dark closes over everything for as
  // long as the search takes, and then tears itself open again.
  if (step.target === null) {
    measure()
    return
  }
  const until = Date.now() + HUNT_MS
  const look = (): void => {
    const element = document.querySelector(step.target as string)
    if (element) {
      // Bring it into view before measuring, or the hole lands where the
      // element used to be.
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      window.setTimeout(() => {
        measure()
        settle()
        window.clearInterval(huntTimer)
      }, 60)
      return
    }
    if (Date.now() > until) {
      window.clearInterval(huntTimer)
      tour.skipStep()
    }
  }
  huntTimer = window.setInterval(look, HUNT_EVERY_MS)
  look()
}

/**
 * The legs: the shelf steps belong on the library, the reader steps inside the
 * book the tour brought. The store says which; the routing happens here, so
 * only one thing ever believes it is steering.
 */
watch(
  () => tour.step,
  async (step, before) => {
    if (!step) return
    if (step.leg !== before?.leg || !before) {
      const target =
        step.leg === 'reader' && tour.bookId
          ? { name: 'reader', params: { id: tour.bookId } }
          : { name: 'library' }
      if (router.currentRoute.value.name !== target.name) {
        // Focus mode and open panels would fight the spotlight for the screen.
        ui.exitFocus()
        ui.closeOverlay()
        await router.push(target).catch(() => {})
      }
    }
    // The assistant is opened for the one step that is about it, and shut for
    // every other — including on the way back, so stepping backwards out of it
    // leaves the reader as it was found.
    ui.setChatOpen(step.stage === 'chat')
    hunt()
  },
  { immediate: true },
)

function onResize(): void {
  if (tour.active) measure()
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onResize, true)
  window.addEventListener('keydown', onKey, true)
})

onBeforeUnmount(() => {
  window.clearInterval(huntTimer)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onResize, true)
  window.removeEventListener('keydown', onKey, true)
  window.clearTimeout(settleTimer)
})

/** The keys the tour owns while it runs. */
const OWNED = new Set(['Escape', 'ArrowRight', 'ArrowLeft', 'Enter'])

/**
 * Keys, taken before anything else can have them.
 *
 * This listens in the CAPTURE phase and stops the event there, so a key the
 * tour acts on never reaches the page underneath. Arrow keys are the reason:
 * the reader turns pages with them, and pressing "next" on a step inside a
 * book was advancing the tour AND turning the page under it — the tour then
 * explaining a page the reader had never seen. Nothing under the dark is
 * clickable; nothing under it should be typeable either.
 */
function onKey(event: KeyboardEvent): void {
  if (!tour.active) return
  if (!OWNED.has(event.key)) return
  if (isTextEntryTarget(event.target)) return
  // Enter aimed at one of the card's own buttons belongs to that button —
  // "back" and "skip the tour" must not both mean "next".
  if (
    event.key === 'Enter' &&
    event.target instanceof HTMLElement &&
    event.target.closest('button')
  ) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') tour.finish()
  else if (event.key === 'ArrowRight' || event.key === 'Enter') tour.next()
  else tour.back()
}

/**
 * The four dim panels, in the order top, bottom, start, end — always four,
 * even when the iris is shut, because then the hole has no width or height and
 * the top and bottom panels meet along a line and cover the screen between
 * them. Every one of these numbers is linear in the hole's own numbers, so
 * while all four transition together the dark stays airtight: there is never
 * a frame where they do not tile the screen.
 */
const panels = computed(() => {
  const view = viewport()
  const box = spot.value
  const right = box.left + box.width
  const bottom = box.top + box.height
  return [
    { top: 0, left: 0, width: view.width, height: box.top },
    { top: bottom, left: 0, width: view.width, height: Math.max(0, view.height - bottom) },
    { top: box.top, left: 0, width: box.left, height: box.height },
    { top: box.top, left: right, width: Math.max(0, view.width - right), height: box.height },
  ]
})

const bullets = computed(() => tour.step?.bulletKeys ?? [])
</script>

<template>
  <div v-if="tour.active" class="tour" data-testid="tour" :data-step="tour.step?.id">
    <div
      v-for="(panel, i) in panels"
      :key="i"
      class="dim"
      :style="{
        top: `${panel.top}px`,
        left: `${panel.left}px`,
        width: `${panel.width}px`,
        height: `${panel.height}px`,
      }"
    ></div>
    <!-- A ring around the hole, so the edge of the dark reads as deliberate
         rather than as something failing to cover the screen. -->
    <div
      class="ring"
      :class="{ shut: !lit }"
      data-testid="tour-hole"
      :data-lit="lit"
      :style="{
        top: `${spot.top}px`,
        left: `${spot.left}px`,
        width: `${spot.width}px`,
        height: `${spot.height}px`,
      }"
    ></div>
    <!-- One pulse outwards as the light lands, so the eye is told where to
         look before it is told what it is looking at. Keyed by step, which is
         what makes the animation play again on the next one. -->
    <div
      v-if="lit"
      :key="`halo-${tour.step?.id}`"
      class="halo"
      aria-hidden="true"
      :style="{
        top: `${spot.top}px`,
        left: `${spot.left}px`,
        width: `${spot.width}px`,
        height: `${spot.height}px`,
      }"
    ></div>

    <!-- Hidden by opacity, never by `display`: a card with `display: none` has
         no width to measure, so the placement would be computed against a box
         of nothing and never clamped to the screen. -->
    <div
      ref="cardRef"
      class="card"
      :class="[`side-${card.side}`, { unplaced: !placed && !settled }]"
      data-testid="tour-card"
      :data-placed="placed"
      tabindex="-1"
      role="dialog"
      aria-live="polite"
      :aria-label="t(tour.step?.titleKey as MessageKey)"
      :style="{ top: `${card.top}px`, left: `${card.left}px` }"
    >
      <i
        v-if="card.side !== 'centre' && card.side !== 'bottom'"
        class="nib"
        aria-hidden="true"
        :style="
          card.side === 'below' || card.side === 'above'
            ? { insetInlineStart: `${nib}px` }
            : { top: `${nib}px` }
        "
      ></i>
      <h2 :key="`title-${tour.step?.id}`" class="title">
        {{ t(tour.step?.titleKey as MessageKey) }}
      </h2>
      <!-- The lines arrive one after another, at reading speed. A row of six
           controls explained all at once is a wall; the same six arriving in
           order are a list being read out. -->
      <ul :key="`lines-${tour.step?.id}`" class="lines">
        <li
          v-for="(key, i) in bullets"
          :key="key"
          :style="{ animationDelay: `${40 + i * 45}ms` }"
        >
          {{ t(key as MessageKey) }}
        </li>
      </ul>
      <footer>
        <!-- How far along, as a line rather than only as a number: the count
             says it and the line shows it. -->
        <span class="bar" aria-hidden="true">
          <span class="fill" :style="{ width: `${((tour.index + 1) / tour.total) * 100}%` }"></span>
        </span>
        <span class="count" data-testid="tour-count">
          {{ t('tour.count', { n: tour.index + 1, total: tour.total }) }}
        </span>
        <button type="button" class="skip" data-testid="tour-skip" @click="tour.finish()">
          {{ t('tour.skip') }}
        </button>
        <button
          v-if="tour.index > 0"
          type="button"
          class="step-btn"
          data-testid="tour-back"
          @click="tour.back()"
        >
          {{ t('tour.back') }}
        </button>
        <button type="button" class="step-btn go" data-testid="tour-next" @click="tour.next()">
          {{ tour.isLast ? t('tour.finish') : t('tour.next') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  /* Over every panel and overlay the app has, including the nav (70) and the
     veiled overlays (60) — a tour that something can cover is not a tour. */
  z-index: 200;
}
/* The dark. Four of these surround the hole; nothing under them can be
   pressed, which is the point. */
/* One duration and one curve for everything that travels, so the dark, the
   ring and the card read as one object moving rather than three things that
   happen to move at the same time. */
.tour {
  --travel: 0.42s;
  --curve: cubic-bezier(0.32, 0.72, 0.2, 1);
  animation: tour-in 0.35s ease both;
}
@keyframes tour-in {
  from {
    opacity: 0;
  }
}
.dim {
  position: fixed;
  background: rgba(8, 7, 6, 0.76);
  backdrop-filter: blur(1.5px);
  transition:
    top var(--travel) var(--curve),
    left var(--travel) var(--curve),
    width var(--travel) var(--curve),
    height var(--travel) var(--curve);
}
.ring {
  position: fixed;
  border: 1px solid var(--gold);
  border-radius: 4px;
  box-shadow:
    0 0 0 1px rgba(240, 174, 47, 0.25),
    0 0 22px rgba(240, 174, 47, 0.12);
  pointer-events: none;
  opacity: 1;
  transition:
    top var(--travel) var(--curve),
    left var(--travel) var(--curve),
    width var(--travel) var(--curve),
    height var(--travel) var(--curve),
    opacity 0.22s ease;
}
/* Shut, not gone: the ring stays in the document at the point the iris closed
   to, so the next step opens it from there instead of building a new one. */
.ring.shut {
  opacity: 0;
}
/* The pulse. It starts on the ring and swells outwards twice, then stops:
   a light being pointed, not an alarm going off. */
.halo {
  position: fixed;
  border: 1px solid var(--gold);
  border-radius: 4px;
  pointer-events: none;
  opacity: 0;
  animation: halo 1.15s var(--curve) 2;
  animation-delay: var(--travel);
}
@keyframes halo {
  0% {
    opacity: 0.55;
    transform: scale(1);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(1.06);
  }
}
.card {
  position: fixed;
  width: min(23rem, calc(100vw - 1.5rem));
  padding: 0.95rem 1.05rem 0.8rem;
  background: var(--bg-panel);
  border: 1px solid var(--gold-deep);
  border-radius: 3px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  opacity: 1;
  transform: none;
  /* It travels with the light rather than blinking out and in — one moving
     thing to follow instead of two disappearing ones. */
  transition:
    top var(--travel) var(--curve),
    left var(--travel) var(--curve),
    opacity 0.3s ease,
    transform 0.3s var(--curve);
}
/* The card takes focus on every step so the keyboard reaches the tour rather
   than the book underneath. That is a move the reader did not ask for, so it
   does not draw a focus ring around the whole card — the buttons inside it
   keep theirs. */
.card:focus {
  outline: none;
}
/* Only before the FIRST placement, when there is no position worth showing:
   after that it always has one, and moves to the next. */
.card.unplaced {
  opacity: 0;
  transform: translateY(6px) scale(0.99);
  pointer-events: none;
}
.nib {
  position: absolute;
  width: 9px;
  height: 9px;
  background: var(--bg-panel);
  border-left: 1px solid var(--gold-deep);
  border-top: 1px solid var(--gold-deep);
  transform: rotate(45deg);
}
.side-below .nib {
  top: -5px;
}
.side-above .nib {
  bottom: -5px;
  transform: rotate(225deg);
}
.side-end .nib {
  inset-inline-start: -5px;
  transform: rotate(-45deg);
}
.side-start .nib {
  inset-inline-end: -5px;
  transform: rotate(135deg);
}
.title {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.9rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gold);
  animation: line-in 0.32s var(--curve) both;
}
/* Each control named on its own line: a row is explained by its list, not by
   pointing at every button in it one at a time. */
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.lines li {
  position: relative;
  padding-inline-start: 0.85rem;
  color: var(--text-dim);
  font-family: var(--font-serif);
  font-size: 0.88rem;
  line-height: 1.45;
  animation: line-in 0.26s var(--curve) both;
}
@keyframes line-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
.lines li::before {
  content: '◆';
  position: absolute;
  inset-inline-start: 0;
  color: var(--gold-deep);
  font-size: 0.5rem;
  top: 0.42em;
}
footer {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.85rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--hair-soft);
}
/* The gold creeps along the footer's hairline as the tour advances. */
.bar {
  position: absolute;
  top: -1px;
  inset-inline: 0;
  height: 1px;
  overflow: hidden;
}
.bar .fill {
  display: block;
  height: 100%;
  background: var(--gold);
  transition: width var(--travel) var(--curve);
}
.count {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.1em;
}
.skip {
  margin-inline-start: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-faint);
  font-size: 0.58rem;
}
.skip:hover {
  border: none;
  color: var(--gold);
  text-decoration: underline;
}
.step-btn {
  font-size: 0.58rem;
}
.step-btn.go {
  border-color: var(--gold-deep);
  color: var(--gold);
}
/* Motion is here to say where to look; a reader who has asked for less of it
   is told the same thing by the words and the ring alone. */
@media (prefers-reduced-motion: reduce) {
  .tour,
  .dim,
  .ring,
  .card,
  .lines li,
  .title,
  .bar .fill {
    transition: none;
    animation: none;
  }
  .halo {
    display: none;
  }
}
</style>
