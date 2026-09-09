<script setup lang="ts">
/**
 * Everything on the go, in one band you push sideways.
 *
 * The book you left last is the first of them; the rest are a swipe away. It
 * was two sections once — an offer, and a row of the others under it — which
 * spent a second heading and a second block of height to say one thing twice.
 * A shelf is mostly shelf, and the vertical space above it is the most
 * expensive on the page.
 *
 * Nothing here is a carousel: there is no timer, no dots, and no state to be
 * wrong about. It is a list of links with `overflow-x: auto`, which is why a
 * keyboard, a screen reader and a trackpad all get it for free; the pointer
 * drag below is added FOR the mouse, which is the one input with no way to
 * push a strip along.
 */
import { ref } from 'vue'
import ContinueReading from '@/components/ContinueReading.vue'
import { useI18n } from '@/i18n'
import type { BookMeta } from '@/lib/types'

defineProps<{ books: readonly BookMeta[] }>()

const { t } = useI18n()

const strip = ref<HTMLUListElement | null>(null)

/**
 * Drag to scroll, for the mouse only.
 *
 * A touch or a trackpad already pushes the strip; a mouse has nothing but the
 * scrollbar, which on a strip this short is a thin line at the bottom. So the
 * row can be grabbed — and because every band in it is a link, a grab that
 * MOVED has to be stopped from also being a click, which is what `dragged` is
 * for. The threshold is there because no hand is perfectly still on a
 * mousedown, and a two-pixel wobble is a click.
 */
const DRAG_SLOP = 4
let startX = 0
let startLeft = 0
const dragging = ref(false)
const dragged = ref(false)

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType !== 'mouse' || event.button !== 0) return
  const element = strip.value
  if (!element) return
  dragging.value = true
  dragged.value = false
  startX = event.clientX
  startLeft = element.scrollLeft
  element.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const element = strip.value
  if (!element) return
  const travelled = event.clientX - startX
  if (Math.abs(travelled) > DRAG_SLOP) dragged.value = true
  // The row follows the hand: dragging left moves the content left.
  element.scrollLeft = startLeft - travelled
}

function endDrag(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  const element = strip.value
  if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
}

/** The click that ends a drag belongs to the drag, not to the band under it. */
function onClickCapture(event: MouseEvent): void {
  if (!dragged.value) return
  dragged.value = false
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <section class="reading" data-testid="reading-strip">
    <h2 class="eyebrow">{{ t('continue.eyebrow') }}</h2>
    <ul
      ref="strip"
      class="strip"
      :class="{ dragging, single: books.length < 2 }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @click.capture="onClickCapture"
    >
      <li v-for="(book, index) in books" :key="book.id">
        <ContinueReading :book="book" :lead="index === 0" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reading {
  margin-top: 1.8rem;
}
.eyebrow {
  margin: 0 0 0.5rem;
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 0.58rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold-deep);
}
/* Proximity snapping rather than mandatory: a deliberate half-scroll to see
   what the next cover is should be allowed to stay where it was put. */
.strip {
  list-style: none;
  margin: 0;
  padding: 0 0 0.4rem;
  display: flex;
  align-items: stretch;
  gap: 0.8rem;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  scrollbar-color: var(--hair-soft) transparent;
  /* Momentum on iOS, and no browser-owned pan on the axis the pointer drag
     handles itself. */
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  overscroll-behavior-x: contain;
}
.strip::-webkit-scrollbar {
  height: 4px;
}
.strip::-webkit-scrollbar-thumb {
  background: var(--hair-soft);
  border-radius: 999px;
}
.strip.dragging {
  cursor: grabbing;
  /* Mid-drag the text under the pointer must not be selected instead. */
  user-select: none;
}
/*
 * Each band is most of the width, never all of it: the sliver of the next one
 * showing at the edge is the only thing that says there IS a next one, and it
 * costs nothing to leave it there. With one book on the go there is nothing
 * to promise, so the band takes the whole row as it always did.
 */
.strip > li {
  flex: none;
  width: 88%;
  max-width: 34rem;
  scroll-snap-align: start;
}
.strip.single > li {
  width: 100%;
  max-width: none;
}
@media (min-width: 700px) {
  .strip > li {
    width: 62%;
  }
}
</style>
