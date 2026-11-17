<script setup lang="ts">
/**
 * Painting spines, offered as a bookplate under the shelf's caption: a small
 * framed price list, each line a thing you can buy and what it costs, joined
 * by a dotted leader — the way a bookshop prices a shelf.
 *
 * "This spine" paints the book in front; "the N remaining" paints every book
 * on the shelf that has never been painted. A painted spine is never thrown
 * away: choosing the cover's spine sets it aside, and the plate then offers
 * it back as "paid" — switching costs nothing in either direction. The second costs
 * real money in one press, so it takes two: the first turns the line into
 * "Press again" and lights the total, the second spends it — the same
 * two-press shape as removing a shelf, and no browser dialog to block the app.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatPrice } from '@/lib/format'
import type { BookMeta } from '@/lib/types'
import { useI18n } from '@/i18n'
import { useLanguageStore } from '@/stores/language'
import { useSettingsStore } from '@/stores/settings'
import { useSpinesStore } from '@/stores/spines'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ book: BookMeta; shelf: readonly BookMeta[] }>()

const { t } = useI18n()
const language = useLanguageStore()
const settings = useSettingsStore()
const spines = useSpinesStore()
const ui = useUiStore()

const hasKey = computed(() => settings.apiKey.trim().length > 0)
watch(
  () => settings.spineModelId,
  (id) => spines.ensurePrice(id),
  { immediate: true },
)

const price = computed(() => spines.priceOfOne())
const quote = (count: number) =>
  formatPrice(price.value === null ? null : price.value * count, language.code)

const isPainted = computed(() => spines.paintedFor(props.book.id) !== null)
const isSetAside = computed(() => spines.setAsideFor(props.book.id))
/** Never painted — a book whose painting was set aside is not one to pay for again. */
const unpainted = computed(() =>
  props.shelf.filter((book) => book.coverBlob && !spines.owned(book.id)),
)

const running = computed(() => spines.painting)
const runningTitle = computed(
  () => props.shelf.find((book) => book.id === running.value?.bookId)?.title ?? '',
)

/** Armed after the first press of "the N remaining"; disarms itself. */
const armed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function paintRest(): void {
  if (!armed.value) {
    armed.value = true
    clearTimeout(disarm)
    disarm = setTimeout(() => (armed.value = false), 5000)
    return
  }
  armed.value = false
  clearTimeout(disarm)
  void spines.paint(unpainted.value)
}
onBeforeUnmount(() => clearTimeout(disarm))

/**
 * What painting is, one press away. A hover alone would leave a phone with
 * nothing, so the "i" is a button that toggles the note; hover and focus
 * open it too, and Escape or a press anywhere else closes it.
 */
const infoOpen = ref(false)
const infoPinned = ref(false)
const infoWrap = ref<HTMLElement | null>(null)
function toggleInfo(): void {
  infoPinned.value = !infoPinned.value
  infoOpen.value = infoPinned.value
}
function closeInfo(): void {
  infoPinned.value = false
  infoOpen.value = false
}
function onDocumentPointer(event: PointerEvent): void {
  if (infoOpen.value && !infoWrap.value?.contains(event.target as Node)) closeInfo()
}
function onDocumentKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && infoOpen.value) closeInfo()
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer)
  document.addEventListener('keydown', onDocumentKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer)
  document.removeEventListener('keydown', onDocumentKey)
})
</script>

<template>
  <div class="plate" data-testid="spine-painter">
    <div class="plate-head">
      <p class="plate-title">{{ t('settings.spineTitle') }}</p>
      <span
        ref="infoWrap"
        class="info"
        @mouseenter="infoOpen = true"
        @mouseleave="infoOpen = infoPinned"
      >
        <button
          type="button"
          class="info-mark"
          data-testid="spine-info"
          :aria-label="t('spine.infoLabel')"
          :aria-expanded="infoOpen"
          aria-describedby="spine-info-note"
          @click="toggleInfo"
          @focus="infoOpen = true"
          @blur="infoOpen = infoPinned"
        >
          <!-- Drawn, not typed: a letter sits where its font puts it, which
               is never the centre of a ring (and an italic one leans out). -->
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="4.4" r="1.15" />
            <path d="M6.7 6.9h2.1v4.9h1.1v0.9H6.1v-0.9h1.2V7.8h-0.6z" />
          </svg>
        </button>
        <Transition name="note">
          <span v-show="infoOpen" id="spine-info-note" class="info-note" role="tooltip">
            {{ t('spine.info') }}
          </span>
        </Transition>
      </span>
    </div>

    <p v-if="running" class="note" role="status">
      {{ t('spine.painting', { title: runningTitle }) }}
      <span v-if="running.total > 1" class="figure">{{
        t('spine.paintingOf', { done: running.done + 1, count: running.total })
      }}</span>
    </p>

    <p v-else-if="!hasKey" class="note">
      {{ t('spine.needKey') }}
      <button type="button" class="inline" @click="ui.overlay = 'settings'">
        {{ t('spine.openSettings') }}
      </button>
    </p>

    <template v-else>
      <button
        v-if="isPainted"
        type="button"
        class="line"
        data-testid="spine-unpaint"
        @click="spines.choose(book.id, 'made')"
      >
        <span class="label">{{ t('spine.unpaint') }}</span>
      </button>
      <button
        v-else-if="isSetAside"
        type="button"
        class="line"
        data-testid="spine-repaint"
        @click="spines.choose(book.id, 'painted')"
      >
        <span class="label">{{ t('spine.usePainted') }}</span>
        <span class="leader" aria-hidden="true"></span>
        <span class="figure">{{ t('spine.paid') }}</span>
      </button>
      <button
        v-else-if="book.coverBlob"
        type="button"
        class="line"
        data-testid="spine-paint"
        @click="spines.paint([book])"
      >
        <span class="label">{{ t('spine.thisOne') }}</span>
        <span class="leader" aria-hidden="true"></span>
        <span class="figure">{{ quote(1) }}</span>
      </button>
      <button
        v-if="unpainted.length > 1"
        type="button"
        class="line"
        :class="{ armed }"
        data-testid="spine-paint-rest"
        @click="paintRest"
      >
        <span class="label">{{
          armed ? t('spine.pressAgain') : t('spine.remaining', { count: unpainted.length })
        }}</span>
        <span class="leader" aria-hidden="true"></span>
        <span class="figure">{{ quote(unpainted.length) }}</span>
      </button>
    </template>

    <p v-if="spines.failure" class="failure" role="alert">
      {{ spines.failure }}
      <button type="button" class="inline" @click="spines.dismissFailure">
        {{ t('spine.dismiss') }}
      </button>
    </p>
  </div>
</template>

<style scoped>
/* A double hairline, the inner one gold: a bookplate's frame. */
.plate {
  /* The info note hangs from the plate, not from the "i": centred on the
     plate, it stays on screen however narrow the phone. */
  position: relative;
  max-width: 17rem;
  margin: 1.4rem auto 0;
  padding: 0.7rem 1rem 0.6rem;
  border: 1px solid var(--hair);
  outline: 1px solid var(--hair-soft);
  outline-offset: 3px;
  text-align: start;
}
.plate-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0 0 0.45rem;
}
.plate-head .plate-title {
  margin: 0;
}
.info {
  display: inline-flex;
}
/* A small gilt "i" in a ring: an upright serif i, drawn on the ring's centre. */
.info-mark {
  display: grid;
  place-items: center;
  width: 1.05rem;
  height: 1.05rem;
  padding: 0;
  border: 1px solid var(--hair);
  border-radius: 50%;
  background: none;
  color: var(--gold);
  cursor: help;
}
.info-mark svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}
.info-mark:hover,
.info-mark[aria-expanded='true'] {
  border-color: var(--gold);
  background: var(--gold);
  color: var(--gold-ink);
}
/* The note opens above the plate, centred on it, so it never covers the
   prices it explains. */
.info-note {
  position: absolute;
  bottom: calc(100% + 0.7rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  width: min(17rem, calc(100vw - 2rem));
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--hair);
  border-radius: 2px;
  background: var(--bg-panel);
  box-shadow: var(--shadow);
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.9rem;
  line-height: 1.45;
  text-align: center;
  color: var(--text-dim);
  white-space: normal;
}
.info-note::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 8px;
  height: 8px;
  border-right: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  background: var(--bg-panel);
  transform: translate(-50%, -4px) rotate(45deg);
}
.note-enter-active,
.note-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.note-enter-from,
.note-leave-to {
  opacity: 0;
  transform: translate(-50%, 4px);
}
.plate-title {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.68rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  text-align: center;
  color: var(--gold);
  margin: 0 0 0.45rem;
}

/* One line of the price list. Reset from the app's mono buttons: this is a
   line of type that happens to be pressable, not a control that looks like one. */
.line {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  width: 100%;
  padding: 0.18rem 0;
  border: 0;
  border-radius: 0;
  background: none;
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: 0.98rem;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text);
  cursor: pointer;
}
.line + .line:not(:hover):not(:focus-visible):not(.armed) .label {
  color: var(--text-dim);
}
.label {
  white-space: nowrap;
  transition: color 0.2s ease;
}
.leader {
  flex: 1 1 auto;
  min-width: 1rem;
  border-bottom: 1px dotted var(--hair);
  transform: translateY(-0.25em);
}
.figure {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: var(--gold);
  white-space: nowrap;
}
.line:hover .label,
.line:focus-visible .label {
  color: var(--gold);
}
.line.armed .label {
  color: var(--gold);
  font-style: italic;
}
/* Armed, the total is the thing to read before pressing again. */
.line.armed .figure {
  background: var(--gold);
  color: var(--gold-ink);
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
}

.note,
.failure {
  margin: 0.1rem 0 0.2rem;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.92rem;
  line-height: 1.4;
  text-align: center;
  color: var(--text-dim);
}
.failure {
  color: var(--danger);
  font-style: normal;
}
.note .figure {
  margin-inline-start: 0.4rem;
}
.inline {
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-style: normal;
  letter-spacing: 0;
  text-transform: none;
  color: var(--gold);
  text-decoration: underline;
  text-decoration-color: var(--hair);
  text-underline-offset: 3px;
  cursor: pointer;
}
</style>
