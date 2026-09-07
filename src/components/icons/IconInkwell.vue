<script setup lang="ts">
/**
 * A round-belly scribe's inkwell holding one highlight pastel. The ink is a
 * rect+surface group CLIPPED to the bowl's inner circle, so however far the
 * hover animation raises it, it can never bleed past the glass. The parent
 * button animates `.ink` (translateY) to make the well fill on hover.
 */
/**
 * `full` draws the ink as a plain disc filling the bowl, with no clip at all.
 * The palette's wells are big enough to read half-filled and animate on hover;
 * the single well in the toolbar has to say ONE thing — this is the colour —
 * at sixteen pixels, and it must not depend on a clip-path to say it.
 *
 * The colour has a default because an unset one would render an empty jar,
 * which looks exactly like a bug and reads as one too.
 */
import { DEFAULT_HIGHLIGHT_HEX } from '@/lib/highlight'

withDefaults(defineProps<{ color?: string; full?: boolean }>(), {
  color: DEFAULT_HIGHLIGHT_HEX,
  full: false,
})

/** Per-instance clip id — SVG ids are document-global, five wells coexist. */
const clipId = `inkwell-clip-${Math.random().toString(36).slice(2, 10)}`
</script>

<template>
  <svg viewBox="0 0 22 26" fill="none" aria-hidden="true">
    <defs v-if="!full">
      <clipPath :id="clipId">
        <circle cx="11" cy="15" r="6.35" />
      </clipPath>
    </defs>
    <rect class="cork" x="8.6" y="1.2" width="4.8" height="3.2" rx="0.8" />
    <circle v-if="full" class="ink ink-full" cx="11" cy="15" r="6.35" :fill="color" />
    <g v-else :clip-path="`url(#${clipId})`">
      <g class="ink">
        <rect x="3" y="13.6" width="16" height="14" :fill="color" />
        <ellipse cx="11" cy="13.6" rx="7" ry="1.15" :fill="color" />
        <ellipse
          cx="11"
          cy="13.6"
          rx="6.2"
          ry="0.95"
          fill="none"
          stroke="rgba(255, 255, 255, 0.35)"
          stroke-width="0.5"
        />
      </g>
    </g>
    <circle class="glass" cx="11" cy="15" r="7" />
    <path class="glass" d="M9 4.4v4M13 4.4v4" />
    <path class="glint" d="M6.6 11.9c-.9 1-1.4 2.1-1.5 3.4" />
  </svg>
</template>

<style scoped>
svg {
  width: 100%;
  height: 100%;
  display: block;
}
.cork {
  fill: var(--gold-deep);
}
.glass {
  stroke: var(--text-dim);
  stroke-width: 1.1;
  stroke-linecap: round;
}
.glint {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 0.8;
  stroke-linecap: round;
}
</style>
