<script setup lang="ts">
/**
 * The book you were last reading, offered at the top of the shelf.
 *
 * One tap back into the page you left. The percentage comes from the reader's
 * own page count (saved on the book), so this bar and the counter in the
 * reader can never tell you two different stories.
 */
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { formatProgress } from '@/lib/pagination'
import { useLanguageStore } from '@/stores/language'
import IconMedallion from '@/components/icons/IconMedallion.vue'
import { useI18n } from '@/i18n'
import type { BookMeta } from '@/lib/types'

const props = defineProps<{ book: BookMeta }>()

const language = useLanguageStore()
const { t } = useI18n()

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

/** null until the book has been opened long enough to count its pages. */
const fraction = computed(() => {
  const value = props.book.progress
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
})
const label = computed(() => formatProgress(fraction.value, language.code))

/**
 * The bar sweeps to its value once, on arrival, rather than being drawn there.
 * The width it settles at is the point — watching it get there is how you read
 * it without reading the number. The aria value never lies about it: only the
 * drawn width is animated.
 */
const drawn = ref(0)
function sweep(): void {
  // Next frame, so the browser has painted the empty rail to sweep FROM.
  requestAnimationFrame(() => {
    drawn.value = fraction.value ?? 0
  })
}
onMounted(sweep)
watch(fraction, () => {
  drawn.value = fraction.value ?? 0
})
const percent = computed(() => `${drawn.value * 100}%`)
</script>

<template>
  <RouterLink
    class="continue"
    data-testid="continue-reading"
    :to="{ name: 'reader', params: { id: book.id } }"
  >
    <img v-if="coverUrl" :src="coverUrl" alt="" class="cover" />
    <span v-else class="cover cover-placeholder" aria-hidden="true">
      <IconMedallion class="ph-knot" />
    </span>

    <span class="body">
      <span class="eyebrow">{{ t('continue.eyebrow') }}</span>
      <span class="title" data-testid="continue-title">{{ book.title }}</span>
      <span v-if="book.author" class="author">{{ book.author }}</span>

      <span class="meter">
        <span
          class="rail"
          :class="{ unknown: fraction === null }"
          role="progressbar"
          data-testid="continue-progress"
          :aria-label="t('continue.progress')"
          :aria-valuenow="fraction === null ? undefined : Math.round(fraction * 100)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuetext="fraction === null ? t('continue.uncounted') : label"
        >
          <span class="fill" :style="{ width: percent }"></span>
        </span>
        <span class="percent" data-testid="continue-percent">{{
          fraction === null ? t('continue.justOpened') : label
        }}</span>
      </span>
    </span>
  </RouterLink>
</template>

<style scoped>
.continue {
  display: flex;
  align-items: center;
  gap: clamp(0.9rem, 3vw, 1.5rem);
  margin-top: 1.8rem;
  padding: clamp(0.8rem, 2.5vw, 1.1rem);
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: linear-gradient(115deg, var(--bg-panel), var(--bg-raise));
  transition:
    border-color 0.25s ease,
    box-shadow 0.3s ease;
}
.continue:hover,
.continue:focus-visible {
  border-color: var(--hair);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
}
.cover {
  flex: none;
  width: clamp(3.2rem, 11vw, 4.4rem);
  aspect-ratio: 2 / 3;
  object-fit: cover;
  display: block;
  border: 1px solid var(--hair-soft);
  border-radius: 2px;
  background: var(--bg-raise);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.cover-placeholder {
  display: grid;
  place-items: center;
}
.ph-knot {
  width: 55%;
  color: var(--gold-deep);
}
.body {
  /* min-width lets a long title ellipsize instead of stretching the row. */
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold-deep);
}
.title {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: clamp(1rem, 3.2vw, 1.2rem);
  line-height: 1.25;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.author {
  font-style: italic;
  font-size: 0.82rem;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meter {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 0.5rem;
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
  transition: width 0.4s var(--ease-wipe);
}
.percent {
  flex: none;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}
</style>
