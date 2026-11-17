<script setup lang="ts">
/**
 * One book on the shelf: a real box in CSS 3D — spine, cover, back, top and
 * fore-edge — so turning it to face the reader is one rotation, not a swap of
 * pictures. It is a link into the reader; the shelf decides whether a click
 * on it opens the book or only brings it to the front (ReadingShelf).
 */
import { computed, ref, watchEffect } from 'vue'
import BookSpine from '@/components/bookshelf/BookSpine.vue'
import { bindingColors, toCss } from '@/lib/spine'
import type { BookMeta } from '@/lib/types'
import type { MadeSpine, PaintedSpine } from '@/stores/spines'

const props = defineProps<{
  book: BookMeta
  index: number
  chosen: boolean
  /** Thickness, px. */
  width: number
  height: number
  coverWidth: number
  made: MadeSpine | null
  painted: PaintedSpine | null
}>()

const coverUrl = ref<string | null>(null)
watchEffect((onCleanup) => {
  const blob = props.book.coverBlob
  if (!blob) {
    coverUrl.value = null
    return
  }
  const url = URL.createObjectURL(blob)
  coverUrl.value = url
  onCleanup(() => URL.revokeObjectURL(url))
})

const colors = computed(
  () => props.painted?.colors ?? props.made?.colors ?? bindingColors(props.book.id),
)
const boxStyle = computed(() => ({
  '--d': `${props.width}px`,
  '--h': `${props.height}px`,
  '--w': `${props.coverWidth}px`,
  '--ground': toCss(colors.value.ground),
  '--ink': toCss(colors.value.ink),
}))
</script>

<template>
  <RouterLink
    class="box"
    :class="{ chosen }"
    :style="boxStyle"
    :to="{ name: 'reader', params: { id: book.id } }"
    :data-index="index"
    :tabindex="chosen ? 0 : -1"
    :aria-current="chosen ? 'true' : undefined"
    :aria-label="book.author ? `${book.title}, ${book.author}` : book.title"
    draggable="false"
  >
    <BookSpine
      class="face face-spine"
      :title="book.title"
      :author="book.author"
      :width="width"
      :height="height"
      :colors="colors"
      :motif="painted ? null : (made?.motif ?? null)"
      :cover-url="coverUrl"
      :painted-url="painted?.url ?? null"
    />
    <div class="face face-cover">
      <img v-if="coverUrl" :src="coverUrl" alt="" draggable="false" />
      <span v-else class="cover-title">{{ book.title }}</span>
      <span class="hinge"></span>
    </div>
    <div class="face face-back"></div>
    <div class="face face-top"></div>
    <div class="face face-edge"></div>
  </RouterLink>
</template>

<style scoped>
.box {
  position: absolute;
  left: 50%;
  top: 0;
  width: 0;
  height: var(--h);
  transform-style: preserve-3d;
  /* Pushed back by half the cover's width, so the SPINE stands at depth zero
     and is drawn exactly its own height: at its old depth the perspective
     enlarged every spine about 7%, and their feet hung through the plank. */
  transform: perspective(1400px) translateZ(calc(var(--w) / -2)) translateY(0) rotateY(0deg);
  transition: transform 0.65s var(--ease-turn);
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
.box:not(.chosen):hover {
  transform: perspective(1400px) translateZ(calc(var(--w) / -2)) translateY(-10px) rotateY(0deg);
  transition-duration: 0.25s;
}
/* Pulled forward and turned to show its cover, the spine still in view. */
.box.chosen {
  transform: perspective(1400px) translateZ(calc(70px - var(--w) / 2)) translateY(-4px)
    rotateY(-72deg);
}
.box:focus-visible .face-cover,
.box:focus-visible .face-spine {
  outline: 2px solid var(--gold);
  outline-offset: 3px;
}

.face {
  position: absolute;
  top: 0;
  height: var(--h);
  backface-visibility: hidden;
}
.face-spine {
  left: calc(var(--d) / -2);
  transform: translateZ(calc(var(--w) / 2));
}
.face-cover {
  width: var(--w);
  left: calc(var(--w) / -2);
  transform: rotateY(90deg) translateZ(calc(var(--d) / 2));
  overflow: hidden;
  background: var(--ground);
  color: var(--ink);
  border-radius: 1px 3px 3px 1px;
}
.face-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.cover-title {
  position: absolute;
  inset: 18% 12%;
  font: 600 1.15rem/1.2 var(--font-display);
  text-align: center;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.hinge {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.35),
    rgba(255, 255, 255, 0.12) 3%,
    rgba(0, 0, 0, 0.12) 5%,
    transparent 9%
  );
}
.face-back {
  width: var(--w);
  left: calc(var(--w) / -2);
  transform: rotateY(-90deg) translateZ(calc(var(--d) / 2));
  background: var(--ground);
  filter: brightness(0.6);
}
.face-top {
  width: var(--d);
  height: var(--w);
  left: calc(var(--d) / -2);
  top: calc((var(--h) - var(--w)) / 2);
  transform: rotateX(90deg) translateZ(calc(var(--h) / 2));
  background: repeating-linear-gradient(0deg, #ece3cf 0 2px, #d8ceb6 2px 3px);
}
.face-edge {
  width: var(--d);
  left: calc(var(--d) / -2);
  transform: rotateY(180deg) translateZ(calc(var(--w) / 2));
  background: repeating-linear-gradient(90deg, #ece3cf 0 2px, #d8ceb6 2px 3px);
}

@media (prefers-reduced-motion: reduce) {
  .box {
    transition: none;
  }
}
</style>
