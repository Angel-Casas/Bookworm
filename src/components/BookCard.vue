<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatCount, formatDuration } from '@/lib/format'
import { formatBytes } from '@/lib/metadata'
import { formatProgress } from '@/lib/pagination'
import { useStatsStore } from '@/stores/stats'
import { useLanguageStore } from '@/stores/language'
import IconMedallion from '@/components/icons/IconMedallion.vue'
import { useI18n } from '@/i18n'
import { durationWordsIn } from '@/i18n/bundles'
import type { BookMeta } from '@/lib/types'

const props = defineProps<{ book: BookMeta; view?: 'big' | 'compact' }>()
defineEmits<{ remove: [id: string]; toggleFinished: [id: string] }>()

const statsStore = useStatsStore()
/** Every number below is shaped for the reader's own language. */
const language = useLanguageStore()
const { t } = useI18n()
const durationWords = computed(() => durationWordsIn(language.code))
const stats = computed(() => statsStore.statsFor(props.book.id))

/**
 * How far in, 0 to 1 — or null for a book nobody has opened yet. An unread
 * book gets NO rail rather than an empty one: an empty bar is a claim about
 * the reader, and a shelf of them would read as a shelf of failures.
 */
const progress = computed(() => {
  const value = props.book.progress
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null
  return Math.min(1, value)
})
const progressLabel = computed(() => formatProgress(progress.value, language.code))

/** Drawn width only — it sweeps to the value on arrival, the way the band at
 *  the top of the shelf does. The number itself is never animated. */
const drawn = ref(0)
onMounted(() => {
  requestAnimationFrame(() => {
    drawn.value = progress.value ?? 0
  })
})
watch(progress, () => {
  drawn.value = progress.value ?? 0
})

const coverUrl = computed(() =>
  props.book.coverBlob ? URL.createObjectURL(props.book.coverBlob) : null,
)

onBeforeUnmount(() => {
  if (coverUrl.value) URL.revokeObjectURL(coverUrl.value)
})
</script>

<template>
  <article class="book-card" :class="view ?? 'compact'">
    <RouterLink
      :to="{ name: 'reader', params: { id: book.id } }"
      class="cover-link"
      :title="view === 'big' ? book.title : undefined"
    >
      <img
        v-if="coverUrl"
        :src="coverUrl"
        :alt="t('card.cover', { title: book.title })"
        class="cover"
      />
      <div v-else class="cover cover-placeholder" aria-hidden="true">
        <span class="ph-frame"></span>
        <IconMedallion class="ph-knot" />
        <span class="ph-title">{{ book.title }}</span>
        <span v-if="book.author" class="ph-author">{{ book.author }}</span>
      </div>
      <span
        v-if="book.finishedAt != null"
        class="seal"
        data-testid="finished-seal"
        :title="t('card.finished')"
      >
        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 6.4 5 8.8 9.6 3.4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="sr-only">{{ t('card.finished') }}</span>
      </span>
    </RouterLink>
    <template v-if="view !== 'big'">
      <h3 class="title">{{ book.title }}</h3>
      <p v-if="book.author" class="author">{{ book.author }}</p>
      <p class="details">
        <span class="format">{{ book.format.toUpperCase() }}</span> ·
        {{ formatBytes(book.fileSize) }}
      </p>
      <!-- Only where there are already words under the cover: the gallery view
           is covers and nothing else, on purpose. -->
      <p
        v-if="progress !== null"
        class="progress"
        data-testid="card-progress"
        role="progressbar"
        :aria-label="t('card.progressOf', { title: book.title })"
        :aria-valuenow="Math.round(progress * 100)"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuetext="progressLabel"
      >
        <span class="rail"><span class="fill" :style="{ width: `${drawn * 100}%` }"></span></span>
        <span class="pct">{{ progressLabel }}</span>
      </p>
      <p v-if="stats" class="details" data-testid="book-stats">
        {{
          t('card.read', {
            duration: formatDuration(stats.readingSeconds, language.code, durationWords),
          })
        }}
        ·
        {{ t('card.pageTurns', { count: formatCount(stats.pageTurns, language.code) }) }}
      </p>
      <div class="card-actions">
        <button type="button" class="remove" @click="$emit('remove', book.id)">
          {{ t('card.remove') }}
        </button>
        <button
          type="button"
          class="finish"
          data-testid="toggle-finished"
          :aria-pressed="book.finishedAt != null"
          @click="$emit('toggleFinished', book.id)"
        >
          {{ book.finishedAt != null ? t('card.finishedTick') : t('card.markFinished') }}
        </button>
      </div>
    </template>
  </article>
</template>

<style scoped>
.book-card {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  /*
   * The card measures itself, so what is drawn INSIDE a coverless cover can be
   * sized against the card rather than against the page. Six to a row on a
   * desk and four on a phone are wildly different widths for the same box, and
   * a title set in rem is either enormous in one or unreadable in the other.
   */
  container-type: inline-size;
}
.cover-link {
  display: block;
  position: relative;
  text-decoration: none;
}
.cover {
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  display: block;
  border: 1px solid var(--hair-soft);
  border-radius: 2px;
  background: var(--bg-raise);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
  transition:
    transform 0.3s var(--ease-wipe),
    border-color 0.25s ease,
    box-shadow 0.3s ease;
}
.cover-link:hover .cover,
.cover-link:focus-visible .cover {
  transform: translateY(-4px);
  border-color: var(--hair);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45);
}
.cover-placeholder {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(0.2rem, 4cqi, 0.55rem);
  padding: clamp(0.4rem, 9cqi, 1.4rem) clamp(0.3rem, 6cqi, 0.9rem);
  text-align: center;
  overflow: hidden;
  background: linear-gradient(170deg, var(--bg-raise), var(--bg-panel));
}
.ph-frame {
  position: absolute;
  inset: 7px;
  border: 1px solid var(--hair-soft);
  border-radius: 1px;
  pointer-events: none;
}
.ph-knot {
  width: 30%;
  max-width: 56px;
  color: var(--gold-deep);
  opacity: 0.9;
}
.ph-title {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: clamp(0.58rem, 6.5cqi, 0.98rem);
  line-height: 1.25;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ph-author {
  font-style: italic;
  font-size: clamp(0.5rem, 5cqi, 0.78rem);
  color: var(--text-faint);
}
.title {
  margin: 0.55rem 0 0;
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.25;
}
.author {
  margin: 0;
  font-style: italic;
  font-size: 0.85rem;
  color: var(--text-dim);
}
.details {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}
/* The same gold rail the shelf's "Continue reading" band uses, at the size a
   card can spare: the two are the same fact about the same book. */
.progress {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0.15rem 0 0;
}
.rail {
  flex: 1 1 auto;
  min-width: 0;
  height: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-faint) 30%, transparent);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gold-deep), var(--gold));
  transition: width 0.55s var(--ease-wipe);
}
.pct {
  flex: none;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}
.seal {
  position: absolute;
  top: clamp(0.25rem, 3cqi, 0.5rem);
  inset-inline-end: clamp(0.25rem, 3cqi, 0.5rem);
  display: grid;
  place-items: center;
  width: clamp(0.9rem, 10cqi, 1.45rem);
  height: clamp(0.9rem, 10cqi, 1.45rem);
  border-radius: 50%;
  background: var(--gold);
  color: var(--gold-ink);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
  border: 1px solid color-mix(in srgb, var(--gold-ink) 25%, var(--gold));
}
.seal svg {
  width: 55%;
  height: 55%;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.card-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.35rem;
}
.remove {
  font-size: 0.58rem;
  padding: 0.45em 0.9em;
  opacity: 0.75;
}
.finish {
  font-size: 0.58rem;
  padding: 0.45em 0.9em;
  opacity: 0.75;
}
.finish:hover {
  opacity: 1;
  color: var(--gold);
  border-color: var(--gold-deep);
}
.finish[aria-pressed='true'] {
  opacity: 1;
  color: var(--gold);
  border-color: var(--gold-deep);
}
.remove:hover {
  opacity: 1;
  color: var(--danger);
  border-color: var(--danger);
}
</style>
