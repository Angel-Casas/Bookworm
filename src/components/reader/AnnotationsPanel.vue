<script setup lang="ts">
import { computed, ref } from 'vue'
import { sortAnnotationsByPosition } from '@/lib/annotationSort'
import type { BookFormat } from '@/lib/types'
import { useAnnotationsStore } from '@/stores/annotations'
import IconClose from '@/components/icons/IconClose.vue'
import IconLamp from '@/components/icons/IconLamp.vue'
import IconNote from '@/components/icons/IconNote.vue'
import IconQuill from '@/components/icons/IconQuill.vue'
import IconFairCopy from '@/components/icons/IconFairCopy.vue'
import { useI18n } from '@/i18n'

type AnnotationFilter = 'all' | 'bookmark' | 'highlight' | 'note'

const props = defineProps<{ bookId: string; format: BookFormat }>()
const emit = defineEmits<{
  jump: [position: string]
  ask: [text: string, position: string]
  save: []
  close: []
}>()

const annotations = useAnnotationsStore()
const { t } = useI18n()
// Bookmarks first: the panel opens from a button called Bookmarks, and losing
// your place is the thing readers come back for. Highlights are one tap away.
const filter = ref<AnnotationFilter>('bookmark')

/** Excerpts start folded to two lines; clicking one unfolds it. */
const expanded = ref<Set<string>>(new Set())

function toggleExpanded(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

// Book order, first page to last — checking one's marks should read like
// walking back through the book, not like a changelog.
const items = computed(() =>
  sortAnnotationsByPosition(annotations.annotationsFor(props.bookId), props.format).filter(
    (item) => filter.value === 'all' || item.type === filter.value,
  ),
)

/** Everything saved in this book, whatever tab is showing. */
const total = computed(() => annotations.annotationsFor(props.bookId).length)

/** How much is waiting on the OTHER tabs, when this one has nothing to show. */
const elsewhere = computed(() => {
  if (filter.value === 'all') return 0
  return annotations.annotationsFor(props.bookId).filter((item) => item.type !== filter.value)
    .length
})

async function onRemove(id: string): Promise<void> {
  await annotations.remove(props.bookId, id)
}
</script>

<template>
  <aside class="annotations-panel" data-testid="annotations-panel" :aria-label="t('panel.marks')">
    <header>
      <strong>{{ t('panel.marksTitle') }}</strong>
      <!-- Marks live in one browser on one device, which is right for reading
           and wrong for everything after it. One file, in reading order, that
           any notes app will open. -->
      <button
        v-if="total > 0"
        type="button"
        class="x-btn save-marks"
        data-testid="save-marks"
        :aria-label="t('panel.save')"
        :title="t('panel.saveShort')"
        @click="emit('save')"
      >
        <IconFairCopy class="save-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="x-btn panel-close"
        :aria-label="t('panel.close')"
        :title="t('overlay.close')"
        @click="emit('close')"
      >
        <IconClose class="x-icon" aria-hidden="true" />
      </button>
    </header>
    <div class="filter-row" role="group" :aria-label="t('panel.filter')">
      <button
        type="button"
        :class="{ active: filter === 'all' }"
        data-testid="filter-all"
        @click="filter = 'all'"
      >
        {{ t('panel.all') }}
      </button>
      <button
        type="button"
        :class="{ active: filter === 'bookmark' }"
        data-testid="filter-bookmarks"
        @click="filter = 'bookmark'"
      >
        {{ t('panel.bookmarks') }}
      </button>
      <button
        type="button"
        :class="{ active: filter === 'highlight' }"
        data-testid="filter-highlights"
        @click="filter = 'highlight'"
      >
        {{ t('panel.highlights') }}
      </button>
      <button
        type="button"
        :class="{ active: filter === 'note' }"
        data-testid="filter-notes"
        @click="filter = 'note'"
      >
        {{ t('panel.notes') }}
      </button>
    </div>
    <p v-if="items.length === 0" class="empty">
      {{
        filter === 'all'
          ? t('panel.emptyAll')
          : filter === 'bookmark'
            ? t('panel.emptyBookmarks')
            : filter === 'note'
              ? t('panel.emptyNotes')
              : t('panel.emptyHighlights')
      }}
      <!-- The panel opens on Bookmarks, so say when the other tab isn't
           empty — otherwise a reader who just saved a highlight is told
           there is nothing here. -->
      <button
        v-if="elsewhere > 0"
        type="button"
        class="crossover"
        data-testid="filter-crossover"
        @click="filter = 'all'"
      >
        {{ t('panel.elsewhere', { count: elsewhere }) }}
      </button>
    </p>
    <ul>
      <li v-for="item in items" :key="item.id" class="item" :data-annotation-type="item.type">
        <div class="item-row">
          <button
            type="button"
            class="jump"
            :title="t('panel.goTo', { label: item.label })"
            @click="emit('jump', item.position)"
          >
            <IconQuill
              v-if="item.type === 'highlight'"
              class="quill-tag"
              :tint="item.color ?? '#f2dd88'"
              aria-hidden="true"
            />
            <IconNote v-else-if="item.type === 'note'" class="note-tag" aria-hidden="true" />
            <IconLamp v-else class="lamp-tag" :lit="true" aria-hidden="true" />
            <span class="label">{{ item.label }}</span>
          </button>
          <button
            type="button"
            class="x-btn item-remove"
            :aria-label="
              item.type === 'bookmark'
                ? t('panel.removeBookmark')
                : item.type === 'note'
                  ? t('panel.removeNote')
                  : t('panel.removeHighlight')
            "
            :title="t('panel.remove')"
            @click="onRemove(item.id)"
          >
            <IconClose class="x-icon" aria-hidden="true" />
          </button>
        </div>
        <blockquote
          v-if="item.text"
          class="excerpt"
          :class="{ folded: !expanded.has(item.id) }"
          role="button"
          tabindex="0"
          :aria-expanded="expanded.has(item.id)"
          :title="expanded.has(item.id) ? t('panel.collapse') : t('panel.expand')"
          @click="toggleExpanded(item.id)"
          @keydown.enter.prevent="toggleExpanded(item.id)"
          @keydown.space.prevent="toggleExpanded(item.id)"
        >
          {{ item.text }}
        </blockquote>
        <div v-if="item.text && expanded.has(item.id)" class="item-actions">
          <button type="button" @click="emit('ask', item.text, item.position)">
            {{ t('panel.askAbout') }}
          </button>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.annotations-panel {
  /* Geometry belongs to .side-slot in ReaderView — the panel only says how
     tall it may grow and how it looks. */
  width: 100%;
  max-height: min(30rem, calc(100vh - 9rem));
  overflow-y: auto;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: var(--bg-panel);
  padding: 0.9rem;
  box-shadow: var(--shadow);
}
/* A kept answer is a slip of paper tucked into the book. */
.note-tag {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-self: center;
  color: var(--gold-mid);
}
/* Highlights are quills dipped in their own pastel. */
.quill-tag {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  align-self: center;
  color: var(--text-dim);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}
/* The title takes the room; the two round buttons sit together at the end. */
header strong {
  flex: 1;
  min-width: 0;
}
.save-marks {
  width: 1.7rem;
  height: 1.7rem;
}
.save-icon {
  width: 15px;
  height: 15px;
  display: block;
}
/* Four tabs across whatever width there is. They SHARE the row equally rather
   than each asking for its own text plus padding — four buttons sized by their
   words came to more than a phone is wide, and the panel had to be dragged
   sideways to reach Notes. */
.filter-row {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}
.filter-row button {
  flex: 1 1 0;
  min-width: 0;
  padding-inline: 0.3em;
  text-align: center;
  white-space: nowrap;
}
/* Below this the words themselves are the width, so they give up the letter
   spacing before they give up being readable. */
@media (max-width: 26rem) {
  .filter-row button {
    font-size: 0.55rem;
    letter-spacing: 0.06em;
    padding-inline: 0.15em;
  }
}
.filter-row .active {
  font-weight: 700;
  text-decoration: underline;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.item {
  border-bottom: 1px solid var(--hair-soft);
  padding-bottom: 0.5rem;
}
.item-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.jump {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: start;
  font: inherit;
}
.jump:hover .label {
  text-decoration: underline;
}
.label {
  color: var(--text);
}
/* Bookmarks are lamps everywhere: the panel tag is the reading lamp, lit. */
.lamp-tag {
  width: 15px;
  height: 18px;
  flex-shrink: 0;
  align-self: center;
  color: var(--gold);
}
/* Handmade curved X, standing in for Close and Remove alike. */
.x-btn {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: none;
  color: var(--text-faint);
  letter-spacing: 0;
}
.x-btn:hover:not(:disabled) {
  color: var(--gold);
  border-color: var(--hair-soft);
  background: none;
}
.panel-close {
  width: 1.7rem;
  height: 1.7rem;
}
.panel-close .x-icon {
  width: 15px;
  height: 15px;
  display: block;
}
.item-remove {
  width: 1.35rem;
  height: 1.35rem;
  margin-top: 0.05rem;
}
.item-remove .x-icon {
  width: 11px;
  height: 11px;
  display: block;
}
.excerpt {
  margin: 0.3rem 0 0.15rem;
  padding: 0;
  color: var(--text-faint);
  font-size: 0.82rem;
  line-height: 1.5;
  cursor: pointer;
  transition: color 0.2s ease;
}
.excerpt:hover,
.excerpt:focus-visible {
  color: var(--text-dim);
}
.excerpt.folded {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.item-actions {
  display: flex;
  gap: 0.5rem;
}
.item-actions button {
  font-size: 0.8rem;
}
.empty {
  color: var(--text-faint);
  font-size: 0.9rem;
}
/* A quiet nudge, not a button: it reads as part of the sentence. */
.crossover {
  display: block;
  margin-top: 0.45rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--gold);
  font-size: 0.68rem;
}
.crossover:hover {
  border: none;
  text-decoration: underline;
}
</style>
