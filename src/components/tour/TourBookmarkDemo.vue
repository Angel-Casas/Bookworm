<script setup lang="ts">
/**
 * The bookmark, shown rather than described.
 *
 * "Pull the chain" is a gesture, and a gesture survives a sentence badly: a
 * reader who has never seen the lamp does not know it HAS a chain, and the
 * fold that answers the pull is at the far corner of the page, where nobody
 * is looking. So the card plays the whole thing small — the tug, the lamp
 * catching, then the corner turning down — and loops it, because a reader
 * glancing up mid-cycle should not have missed their only chance.
 *
 * The lamp and the fold are the app's own components, not drawings of them.
 * The fold in particular animates for a second and a half of its own accord;
 * borrowing it means the card shows the ceremony the reader will actually
 * get, and cannot drift away from it later.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import IconLamp from '@/components/icons/IconLamp.vue'
import PageDogEar from '@/components/reader/PageDogEar.vue'

/** The chain is tugged, the lamp catches, the corner turns, all of it rests,
 *  and it begins again. Milliseconds from the top of each cycle. */
const PULL_AT = 600
const MARK_AT = 1000
const REST_AT = 3400
const CYCLE = 4600

const pulling = ref(false)
const lit = ref(false)
const marked = ref(false)

const timers: number[] = []
let cycle = 0

function at(delay: number, run: () => void): void {
  timers.push(window.setTimeout(run, delay))
}

function play(): void {
  at(PULL_AT, () => {
    pulling.value = true
  })
  at(PULL_AT + 260, () => {
    pulling.value = false
    lit.value = true
  })
  at(MARK_AT, () => {
    marked.value = true
  })
  // Un-marking uses the fold's own 'draw' exit, so the loop ends the way a
  // reader taking the bookmark off would end it, rather than by blinking out.
  at(REST_AT, () => {
    marked.value = false
    lit.value = false
  })
}

onMounted(() => {
  // A reader who has asked for less motion is shown the finished state and
  // left alone: the sentence beside it already says what the gesture is.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    lit.value = true
    marked.value = true
    return
  }
  play()
  cycle = window.setInterval(play, CYCLE)
})

onBeforeUnmount(() => {
  window.clearInterval(cycle)
  for (const timer of timers) window.clearTimeout(timer)
})
</script>

<template>
  <div class="demo" aria-hidden="true">
    <!-- The page, with the corner the fold lands on. -->
    <div class="page">
      <PageDogEar :marked="marked" exit="draw" />
      <i v-for="line in 5" :key="line" class="rule" :class="{ short: line === 5 }"></i>
    </div>
    <!-- The lamp, with the chain above it that is the thing being pulled. -->
    <div class="lamp-seat" :class="{ pulling }">
      <span class="chain"></span>
      <IconLamp :lit="lit" class="lamp-art" />
    </div>
  </div>
</template>

<style scoped>
.demo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
  margin: 0 0 0.7rem;
  padding: 0.7rem 0.6rem;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
}
/* The page. `--page-top` and `--page-inset` are what PageDogEar rides; inside
   the demo the page IS the stage, so both are zero. */
.page {
  --page-top: 0px;
  --page-inset: 0px;
  position: relative;
  width: 74px;
  height: 58px;
  flex: none;
  border: 1px solid var(--hair-soft);
  border-radius: 3px 0 0 3px;
  background: var(--bg-panel);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 0 9px;
}
/* The fold sizes itself against a real page; here it is told a size, since
   9% of 74px would be a speck. */
.page :deep(.dogear) {
  width: 26px;
}
/* Lines of type, so the shape reads as a page and not as an empty box. */
.rule {
  height: 1px;
  background: var(--text-faint);
  opacity: 0.35;
}
.rule.short {
  width: 55%;
}
.lamp-seat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--gold-deep);
  transition: transform 0.24s cubic-bezier(0.34, 1.3, 0.64, 1);
}
/* The tug: everything below the ceiling travels down a few pixels and springs
   back — which is what a pulled chain does. */
.lamp-seat.pulling {
  transform: translateY(5px);
}
.chain {
  width: 1px;
  height: 9px;
  background: currentColor;
  opacity: 0.55;
}
.lamp-art {
  width: 30px;
  height: 36px;
  color: var(--gold);
}
@media (prefers-reduced-motion: reduce) {
  .lamp-seat {
    transition: none;
  }
}
</style>
