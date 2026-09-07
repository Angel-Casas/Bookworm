<script setup lang="ts">
/**
 * A line with one word swept under by a hand-drawn stroke.
 *
 * The landing page's headlines each lean on a single word, and the swash is
 * drawn under that word rather than under the line. In English the word can
 * be anywhere in the sentence; in another language it will be somewhere else
 * — so the message carries `{swash}` and the underlined word arrives as its
 * own key, and the markup never has to know which language it is in.
 *
 * The stroke's path is passed in so each headline keeps its own wobble: they
 * were drawn one at a time, and a single shared curve reads as a rule.
 */
import { computed } from 'vue'

const props = defineProps<{ text: string; word: string; path: string }>()

const parts = computed(() => {
  const at = props.text.indexOf('{swash}')
  // A translation that lost the placeholder still reads: the word simply goes
  // where the sentence ends up putting it.
  if (at === -1) return [props.text, '']
  return [props.text.slice(0, at), props.text.slice(at + '{swash}'.length)]
})
</script>

<template>
  <span
    >{{ parts[0]
    }}<span class="u"
      >{{ word
      }}<svg class="usvg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        <path :d="path" pathLength="1" /></svg></span
    >{{ parts[1] }}</span
  >
</template>

<style scoped>
/* One key word per headline: a hand-drawn gold underline, drawn by --k, which
   the beat that contains this sets and CSS inheritance carries in. */
.u {
  position: relative;
  white-space: nowrap;
}
.usvg {
  position: absolute;
  left: -3%;
  bottom: -0.16em;
  width: 106%;
  height: 0.42em;
  overflow: visible;
}
.usvg path {
  fill: none;
  stroke: var(--goldhi);
  stroke-width: 1.8;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  opacity: 0.92;
  stroke-dasharray: 1;
  stroke-dashoffset: calc(1 - clamp(0, (var(--k, 0) - 0.55) * 2.4, 1));
}
</style>
