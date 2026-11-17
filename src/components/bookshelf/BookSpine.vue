<script setup lang="ts">
/**
 * One spine, as the shelf shows it.
 *
 * Made from the cover: the cover's ground, a colour from the cover for the
 * ink, and — when the cover has a picture — a small piece of it at the top,
 * fading into the ground (lib/spine). Painted: the artwork a model drew from
 * the cover (lib/spineArt), with the title still set here, because a spine is
 * the one place the title must be readable.
 */
import { computed } from 'vue'
import IconMedallion from '@/components/icons/IconMedallion.vue'
import { PAINTED_EMBLEM_SHARE } from '@/lib/spineArt'
import {
  fitTitle,
  spineAuthor,
  spineTitle,
  toCss,
  type Region,
  type SpineColors,
} from '@/lib/spine'

const props = defineProps<{
  title: string
  author: string | null
  /** Thickness, px. */
  width: number
  height: number
  colors: SpineColors
  motif: Region | null
  coverUrl: string | null
  paintedUrl: string | null
}>()

/** The picture at the top: as wide as the spine, a little taller than wide. */
const motifTop = computed(() => props.width * 0.16)
const motifHeight = computed(() => props.width * 1.2)

const motifStyle = computed(() => {
  const m = props.motif
  if (!m || !props.coverUrl || props.paintedUrl) return null
  const bgW = props.width / m.w
  const bgH = motifHeight.value / m.h
  return {
    top: `${motifTop.value}px`,
    height: `${motifHeight.value}px`,
    backgroundImage: `url("${props.coverUrl}")`,
    backgroundSize: `${bgW}px ${bgH}px`,
    backgroundPosition: `${-m.x * bgW}px ${-m.y * bgH}px`,
  }
})

const titleTop = computed(() => {
  if (props.paintedUrl) return props.height * PAINTED_EMBLEM_SHARE
  if (motifStyle.value) return motifTop.value + motifHeight.value + props.width * 0.2
  return props.width * 0.42
})
const footHeight = computed(() => props.width * 1.3)
const fit = computed(() =>
  fitTitle(spineTitle(props.title), props.height - titleTop.value - footHeight.value, props.width),
)
const surname = computed(() => spineAuthor(props.author))
/** Spaced capitals run about 0.9em a letter; leave a margin either side. */
const surnameSize = computed(() =>
  Math.min(props.width * 0.19, (props.width * 0.82) / (Math.max(1, surname.value.length) * 0.9)),
)

const faceStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
  '--ground': toCss(props.colors.ground),
  '--ink': toCss(props.colors.ink),
  '--accent': toCss(props.colors.accent),
  backgroundImage: props.paintedUrl ? `url("${props.paintedUrl}")` : undefined,
}))
</script>

<template>
  <div class="spine" :class="{ painted: paintedUrl }" :style="faceStyle" aria-hidden="true">
    <div v-if="motifStyle" class="motif" :style="motifStyle"></div>
    <div v-else-if="!paintedUrl" class="rule" :style="{ top: `${width * 0.22}px` }"></div>
    <div
      class="title"
      :style="{
        top: `${titleTop}px`,
        height: `${height - titleTop - footHeight}px`,
        fontSize: `${fit.size}px`,
      }"
      v-text="fit.lines.join('\n')"
    ></div>
    <div class="foot" :style="{ height: `${footHeight}px` }">
      <span v-if="surname" class="surname" :style="{ fontSize: `${surnameSize}px` }">{{
        surname
      }}</span>
      <IconMedallion class="mark" :style="{ width: `${width * 0.42}px` }" />
    </div>
    <div class="shade"></div>
  </div>
</template>

<style scoped>
.spine {
  position: relative;
  overflow: hidden;
  background-color: var(--ground);
  background-size: cover;
  background-position: center top;
  color: var(--ink);
  border-radius: 2px 1px 1px 2px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.motif {
  position: absolute;
  left: 0;
  right: 0;
  background-repeat: no-repeat;
  -webkit-mask-image: linear-gradient(180deg, #000 0 72%, transparent);
  mask-image: linear-gradient(180deg, #000 0 72%, transparent);
}
.rule {
  position: absolute;
  left: 22%;
  right: 22%;
  height: 1px;
  background: var(--accent);
  opacity: 0.8;
}
.title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  writing-mode: vertical-rl;
  text-align: center;
  font-family: var(--font-display);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.1;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.painted .title {
  text-shadow: 0 0 6px color-mix(in srgb, var(--ground) 80%, transparent);
}
.foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 12%;
  padding-bottom: 14%;
}
.surname {
  font-family: var(--font-serif);
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.85;
  white-space: nowrap;
}
.mark {
  color: var(--accent);
  display: block;
  aspect-ratio: 1;
}
/* The spine is round: light from the left, shadow into the joints. */
.shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.38),
    rgba(255, 255, 255, 0.1) 22%,
    rgba(255, 255, 255, 0.03) 45%,
    rgba(0, 0, 0, 0.08) 70%,
    rgba(0, 0, 0, 0.42)
  );
}
</style>
