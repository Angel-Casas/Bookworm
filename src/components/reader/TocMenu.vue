<script setup lang="ts">
/**
 * The book's contents, in the app's own hand.
 *
 * A native <select> gave the one thing a contents list must have — where you
 * are — no way to show itself: the chapter you are reading looked exactly like
 * the 250 you are not. This menu names the current chapter on the closed
 * trigger, marks it in the open list, indents the sections beneath their
 * chapters, and opens scrolled to your place rather than to the top of a book
 * you are halfway through.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { currentTocIndex, type TocEntry } from '@/lib/toc'
import { dropFrom, shiftIntoView } from '@/lib/popover'
import IconClose from '@/components/icons/IconClose.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{
  entries: readonly TocEntry[]
  /** Href of the section on screen, as the reader reports it. */
  currentHref: string | null
}>()

const emit = defineEmits<{ select: [href: string] }>()

const open = ref(false)
const active = ref(0)
const rootRef = ref<HTMLDivElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const sheetRef = ref<HTMLDivElement | null>(null)
/** How much room there is above the trigger; the sheet never exceeds it. */
const maxHeight = ref(360)
/** How far the sheet slides sideways to stay on a narrow screen. */
const shift = ref(0)

const currentIndex = computed(() => currentTocIndex(props.entries, props.currentHref))
const currentLabel = computed(() => props.entries[currentIndex.value]?.label ?? null)

function scrollToActive(): void {
  void nextTick(() => {
    listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'center' })
  })
}

function openMenu(): void {
  const rect = rootRef.value?.getBoundingClientRect()
  // The contents sit at the foot of the reader, so the sheet opens upward and
  // takes only the room actually above it — under the toolbar, never over it.
  if (rect) {
    maxHeight.value = dropFrom(rect, window.innerHeight, {
      topInset: 96,
      bottomMargin: 8,
      wanted: 420,
      min: 160,
    }).maxHeight
  }
  // Open where the reader is, not at the top of a book they are halfway into.
  active.value = currentIndex.value === -1 ? 0 : currentIndex.value
  open.value = true
  shift.value = 0
  // The list takes focus, so the arrows walk chapters instead of scrolling the
  // page — and so Escape has somewhere inside the menu to be pressed.
  void nextTick(() => {
    // The sheet is aligned to a trigger sitting in the middle of the pager row;
    // on a phone that puts its right edge off the screen.
    const box = sheetRef.value?.getBoundingClientRect()
    if (box) shift.value = shiftIntoView(box, window.innerWidth)
    listRef.value?.focus()
    scrollToActive()
  })
}

function close(returnFocus = true): void {
  open.value = false
  if (returnFocus) void nextTick(() => triggerRef.value?.focus())
}

function choose(href: string): void {
  emit('select', href)
  close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    const entry = props.entries[active.value]
    if (entry) {
      event.preventDefault()
      choose(entry.href)
    }
    return
  }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (step === 0 || props.entries.length === 0) return
  event.preventDefault()
  active.value = (active.value + step + props.entries.length) % props.entries.length
  scrollToActive()
}

function onDocumentPointer(event: PointerEvent): void {
  if (!open.value) return
  // A click elsewhere is the reader going back to the book, so focus stays
  // where they put it rather than snapping back to the trigger.
  if (!rootRef.value?.contains(event.target as Node)) close(false)
}
document.addEventListener('pointerdown', onDocumentPointer)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))

// Turning the page while the menu is open should move the mark with the book.
watch(
  () => props.currentHref,
  () => {
    if (open.value) active.value = currentIndex.value === -1 ? active.value : currentIndex.value
  },
)
</script>

<template>
  <div ref="rootRef" class="toc" data-testid="toc" @keydown="onKeydown">
    <button
      type="button"
      ref="triggerRef"
      class="toc-trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="t('toc.title')"
      data-testid="toc-trigger"
      @click="open ? close(false) : openMenu()"
    >
      <span class="toc-word">{{ t('toc.word') }}</span>
      <span v-if="currentLabel" class="toc-where" data-testid="toc-where">{{ currentLabel }}</span>
      <i class="caret" aria-hidden="true"></i>
    </button>

    <Transition name="pop-fade">
      <div
        v-if="open"
        ref="sheetRef"
        class="sheet"
        :style="{ maxHeight: `${maxHeight}px`, transform: `translateX(${shift}px)` }"
        role="listbox"
        :aria-label="t('toc.chapters')"
      >
        <div class="sheet-head">
          <span class="head-word">{{ t('toc.word') }}</span>
          <span class="head-count" data-testid="toc-count">{{ entries.length }}</span>
          <button
            type="button"
            class="x-btn"
            :aria-label="t('toc.close')"
            :title="t('overlay.close')"
            data-testid="toc-close"
            @click="close()"
          >
            <IconClose class="x-icon" aria-hidden="true" />
          </button>
        </div>
        <div ref="listRef" class="list" tabindex="-1">
          <button
            v-for="(entry, index) in entries"
            :key="`${entry.href}:${index}`"
            type="button"
            class="entry"
            :class="{ here: index === currentIndex }"
            :data-depth="entry.depth"
            :data-active="index === active"
            :data-href="entry.href"
            :aria-current="index === currentIndex ? 'true' : undefined"
            @click="choose(entry.href)"
          >
            <span class="entry-label">{{ entry.label }}</span>
            <i v-if="index === currentIndex" class="here-dot" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toc {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 22rem;
}

/* ————— closed: where you are ————— */
.toc-trigger {
  display: flex;
  /* Fills the seat the row gives it (see .controls > * in the readers), with
     its two labels centred rather than sitting on a baseline that a taller
     font would move. */
  height: 100%;
  align-items: center;
  justify-content: flex-start;
  gap: 0.55rem;
  width: 100%;
  min-width: 0;
  text-align: start;
  padding: 0.5em 0.9em;
}
.toc-word {
  flex-shrink: 0;
}
.toc-where {
  flex: 1;
  min-width: 0;
  font-family: var(--font-body, 'EB Garamond', Georgia, serif);
  font-size: 0.86rem;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.caret {
  flex-shrink: 0;
  align-self: center;
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-bottom: 4px solid currentColor;
  opacity: 0.7;
}

/* ————— open ————— */
.sheet {
  position: absolute;
  z-index: 40;
  inset-inline-start: 0;
  bottom: calc(100% + 0.4rem);
  width: min(26rem, calc(100vw - 2rem));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: var(--bg-panel);
  box-shadow: var(--shadow);
}
.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem 0.45rem;
  border-bottom: 1px solid var(--hair-soft);
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold-deep);
}
.head-count {
  flex: 1;
  color: var(--text-faint);
  opacity: 0.7;
}
.x-btn {
  align-self: center;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-color: transparent;
  border-radius: 50%;
  color: var(--text-faint);
}
.x-btn:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.x-icon {
  width: 11px;
  height: 11px;
  display: block;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.3rem 0.35rem 0.5rem;
}
.list:focus-visible {
  outline: none;
}
.entry {
  position: relative;
  display: flex;
  justify-content: flex-start;
  align-items: baseline;
  width: 100%;
  gap: 0.5rem;
  padding: 0.35rem 1.2rem 0.35rem 0.5rem;
  border: none;
  border-radius: 2px;
  background: none;
  text-align: start;
  text-transform: none;
  letter-spacing: normal;
  font-family: var(--font-body, 'EB Garamond', Georgia, serif);
  font-size: 0.92rem;
  color: var(--text-dim);
}
/* Sections sit under their chapter, as they do on a printed contents page. */
.entry[data-depth='1'] {
  padding-inline-start: 1.6rem;
  font-size: 0.86rem;
}
.entry[data-depth='2'] {
  padding-inline-start: 2.7rem;
  font-size: 0.84rem;
}
.entry[data-depth='3'] {
  padding-inline-start: 3.8rem;
  font-size: 0.82rem;
}
.entry:hover,
.entry[data-active='true'] {
  background: var(--bg-raise);
  border: none;
  color: var(--text);
}
/* Where you are: gold, and marked — the one thing a <select> could not show. */
.entry.here {
  color: var(--gold);
  background: rgba(209, 146, 30, 0.07);
  box-shadow: inset 2px 0 0 var(--gold);
}
.entry-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.here-dot {
  position: absolute;
  inset-inline-end: 0.45rem;
  top: 50%;
  margin-top: -2.5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold);
}

@media (max-width: 640px) {
  .toc-where {
    display: none;
  }
}
</style>
