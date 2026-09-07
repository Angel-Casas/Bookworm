<script setup lang="ts">
/**
 * A bookmarked page turns its top-left corner down in gold: the flap slips
 * out from beneath the page, then the house medallion draws itself into it —
 * a seed dot, four petals in sequence, the ring closing around them, a crown
 * dot to finish.
 *
 * Decorative only (aria-hidden, pointer-events: none): the lamp is the
 * control, and the reader's tap zones must stay untouched.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    marked: boolean
    /**
     * How the fold should leave. 'draw' un-draws the mark and slips the flap
     * back — the ceremony belongs to the reader taking the bookmark off.
     * 'cut' is instant, for every other reason the fold stops applying: the
     * page turned, the text re-flowed, another book opened. Animating those
     * would claim a removal that never happened.
     */
    exit?: 'draw' | 'cut'
  }>(),
  { exit: 'cut' },
)

/**
 * The leave animation needs the element to stay mounted while it plays, so
 * it rides a class rather than v-if. A class toggle also has no enter/leave
 * lifecycle to interrupt — see Docs/LESSONS.md on stranded morphs.
 */
/** Covers the exit: crown, ring, petals, seed, then the flap slipping back. */
const LEAVE_MS = 920
const leaving = ref(false)
let timer = 0

watch(
  () => props.marked,
  (now, was) => {
    window.clearTimeout(timer)
    if (was && !now && props.exit === 'draw') {
      leaving.value = true
      timer = window.setTimeout(() => {
        leaving.value = false
      }, LEAVE_MS)
    } else {
      leaving.value = false
    }
  },
)

onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <div
    class="dogear"
    :class="{ marked, leaving }"
    :data-marked="marked"
    data-testid="page-dogear"
    aria-hidden="true"
  >
    <div class="clip">
      <div class="slip">
        <svg viewBox="0 0 84 84" fill="none">
          <path d="M0 0h59L0 59z" fill="var(--gold)" />
          <path d="M59 0 0 59" stroke="var(--gold-ink)" stroke-opacity="0.22" stroke-width="1" />
          <!-- outer group places the mark, inner group animates it: a CSS
               transform here would override the placement attribute. -->
          <g transform="translate(19.5 19.5) scale(0.62)">
            <g class="mark">
              <circle class="seed" cx="0" cy="0" />
              <path
                class="petal"
                pathLength="100"
                d="M0 0c-4.6-5.1-4.6-13.3 0-13.3s4.6 8.2 0 13.3z"
              />
              <path
                class="petal"
                pathLength="100"
                d="M0 0c5.1-4.6 13.3-4.6 13.3 0s-8.2 4.6-13.3 0z"
              />
              <path
                class="petal"
                pathLength="100"
                d="M0 0c4.6 5.1 4.6 13.3 0 13.3s-4.6-8.2 0-13.3z"
              />
              <path
                class="petal"
                pathLength="100"
                d="M0 0c-5.1 4.6-13.3 4.6-13.3 0s8.2-4.6 13.3 0z"
              />
              <circle
                class="ring"
                pathLength="100"
                cx="0"
                cy="0"
                r="18.5"
                transform="rotate(-90)"
              />
              <circle class="cap" cx="0" cy="-18.5" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dogear {
  position: absolute;
  /* The stage sets --page-top and --page-inset; the fold rides the PAGE's
     top-left corner, which is not the stage's when one page is shown. */
  top: var(--page-top);
  inset-inline-start: var(--page-inset, 0px);
  width: clamp(3.4rem, 9%, 4.6rem);
  aspect-ratio: 1;
  z-index: 15;
  pointer-events: none;
}
.clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* match the page's own rounded corner */
  border-radius: 3px 0 0 0;
}
svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* ————— the slip: the flap slides out from beneath the page —————
   Leaving MUST use its own @keyframes name. Re-pointing the same
   animation-name at a new rule does not restart it: the browser keeps the
   finished animation and snaps to its end state, so the exit plays as an
   instant disappearance (see Docs/LESSONS.md). */
.slip {
  position: absolute;
  inset: 0;
  opacity: 0;
}
.marked .slip {
  animation: slip-in 0.8s cubic-bezier(0.34, 1.16, 0.64, 1) both;
}
.leaving .slip {
  animation: slip-out 0.42s 0.46s cubic-bezier(0.55, 0, 0.75, 0.5) both;
}
@keyframes slip-in {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
  100% {
    opacity: 1;
    transform: translate(0, 0);
  }
}
@keyframes slip-out {
  0% {
    opacity: 1;
    transform: translate(0, 0);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

/* ————— the mark, drawn: seed, petals, ring, crown ————— */
.mark {
  opacity: 0;
}
/* Visible through the whole exit too — the mark un-draws rather than blinks. */
.marked .mark,
.leaving .mark {
  opacity: 1;
}
.seed {
  fill: var(--gold-ink);
  fill-opacity: 0.5;
  r: 0;
}
.marked .seed {
  animation: seed-in 0.3s 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.leaving .seed {
  animation: seed-out 0.14s 0.38s cubic-bezier(0.65, 0, 0.35, 1) both;
}
@keyframes seed-in {
  0% {
    r: 0;
  }
  100% {
    r: 1.7;
  }
}
@keyframes seed-out {
  0% {
    r: 1.7;
  }
  100% {
    r: 0;
  }
}
.petal {
  stroke: var(--gold-ink);
  stroke-opacity: 0.5;
  stroke-width: 2.1;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
}
.marked .petal {
  animation: draw 0.34s cubic-bezier(0.65, 0, 0.35, 1) both;
}
.marked .petal:nth-of-type(1) {
  animation-delay: 0.66s;
}
.marked .petal:nth-of-type(2) {
  animation-delay: 0.76s;
}
.marked .petal:nth-of-type(3) {
  animation-delay: 0.86s;
}
.marked .petal:nth-of-type(4) {
  animation-delay: 0.96s;
}
/* Retracting in reverse order: last petal drawn is first to go. */
.leaving .petal {
  animation: undraw 0.18s cubic-bezier(0.65, 0, 0.35, 1) both;
}
.leaving .petal:nth-of-type(4) {
  animation-delay: 0.12s;
}
.leaving .petal:nth-of-type(3) {
  animation-delay: 0.17s;
}
.leaving .petal:nth-of-type(2) {
  animation-delay: 0.22s;
}
.leaving .petal:nth-of-type(1) {
  animation-delay: 0.27s;
}
.ring {
  stroke: var(--gold-ink);
  stroke-opacity: 0.4;
  stroke-width: 1.7;
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
}
.marked .ring {
  animation: draw 0.62s 1.02s cubic-bezier(0.65, 0, 0.35, 1) both;
}
.leaving .ring {
  animation: undraw 0.26s 0.03s cubic-bezier(0.65, 0, 0.35, 1) both;
}
.cap {
  fill: var(--gold-ink);
  fill-opacity: 0.5;
  r: 0;
}
.marked .cap {
  animation: cap-in 0.28s 1.5s cubic-bezier(0.34, 1.16, 0.64, 1) both;
}
.leaving .cap {
  animation: cap-out 0.16s cubic-bezier(0.65, 0, 0.35, 1) both;
}
@keyframes cap-in {
  0% {
    r: 0;
  }
  100% {
    r: 2.2;
  }
}
@keyframes cap-out {
  0% {
    r: 2.2;
  }
  100% {
    r: 0;
  }
}
@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes undraw {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: 100;
  }
}

/* Reduced motion: the fold simply is, or isn't. */
@media (prefers-reduced-motion: reduce) {
  .marked .slip,
  .leaving .slip,
  .marked .seed,
  .leaving .seed,
  .marked .petal,
  .leaving .petal,
  .marked .ring,
  .leaving .ring,
  .marked .cap,
  .leaving .cap {
    animation: none;
  }
  .leaving .mark {
    opacity: 0;
  }
  .slip {
    opacity: 0;
  }
  .marked .slip {
    opacity: 1;
  }
  .marked .seed,
  .marked .cap {
    r: 1.7;
  }
  .marked .cap {
    r: 2.2;
  }
  .marked .petal,
  .marked .ring {
    stroke-dashoffset: 0;
  }
}
</style>
