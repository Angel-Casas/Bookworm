<script setup lang="ts">
/**
 * Making shelves and putting books on them — one panel, three ways in.
 *
 *   new   — name a shelf; it then turns into that shelf's page, so the next
 *           thing the reader does is choose its books.
 *   shelf — rename it, choose its books, move it, take it down.
 *   book  — which shelves one book stands on, with what its own file says it
 *           is about offered as one-tap shelves.
 *
 * Every tick is saved as it is made: there is no "save" to forget.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { hasTopic, sameTopic } from '@/lib/topics'
import { useLibraryStore } from '@/stores/library'
import { useTopicsStore } from '@/stores/topics'
import { useI18n } from '@/i18n'
import OverlayShell from './OverlayShell.vue'
import BookThumb from '@/components/shelves/BookThumb.vue'

export type ShelfTarget =
  { kind: 'new' } | { kind: 'shelf'; topic: string } | { kind: 'book'; bookId: string }

const props = defineProps<{ target: ShelfTarget }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()
const topics = useTopicsStore()
const { t } = useI18n()

const current = ref<ShelfTarget>(props.target)
const nameField = ref<HTMLInputElement | null>(null)
const draft = ref('')
const renameTo = ref('')
const confirmingRemove = ref(false)
const suggestions = ref<string[]>([])
const busy = ref(false)

const shelfName = computed(() => (current.value.kind === 'shelf' ? current.value.topic : ''))
const book = computed(() =>
  current.value.kind === 'book'
    ? (library.books.find(
        (candidate) => candidate.id === (current.value as { bookId: string }).bookId,
      ) ?? null)
    : null,
)
const title = computed(() => {
  if (current.value.kind === 'new') return t('shelves.new')
  if (current.value.kind === 'shelf') return current.value.topic
  return t('shelves.forBook')
})
const position = computed(() =>
  topics.topics.findIndex((topic) => sameTopic(topic, shelfName.value)),
)

watch(
  current,
  (target) => {
    confirmingRemove.value = false
    draft.value = ''
    if (target.kind === 'shelf') renameTo.value = target.topic
  },
  { immediate: true },
)

onMounted(async () => {
  nameField.value?.focus()
  if (current.value.kind === 'book') {
    suggestions.value = await topics.suggestionsFor(current.value.bookId).catch(() => [])
  }
})

/** Busy-guarded, so a double tap does not make two of anything. */
async function run(work: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await work()
  } finally {
    busy.value = false
  }
}

function makeShelf(): Promise<void> {
  return run(async () => {
    const made = await topics.createShelf(draft.value)
    if (made !== null) current.value = { kind: 'shelf', topic: made }
  })
}

function rename(): Promise<void> {
  return run(async () => {
    const from = shelfName.value
    await topics.renameShelf(from, renameTo.value)
    const now = topics.topics.find((topic) => sameTopic(topic, renameTo.value.trim()))
    if (now) current.value = { kind: 'shelf', topic: now }
  })
}

function move(by: -1 | 1): Promise<void> {
  return run(() => topics.moveShelf(shelfName.value, by))
}

function remove(): Promise<void> {
  if (!confirmingRemove.value) {
    confirmingRemove.value = true
    return Promise.resolve()
  }
  return run(async () => {
    await topics.removeShelf(shelfName.value)
    emit('close')
  })
}

function toggleBook(bookId: string, on: boolean): Promise<void> {
  return run(() => topics.setOnShelf(bookId, shelfName.value, on))
}

function toggleTopic(topic: string, on: boolean): Promise<void> {
  const id = book.value?.id
  if (!id) return Promise.resolve()
  return run(() => topics.setOnShelf(id, topic, on))
}

/** Make a shelf (or find the one by that name) and put this book on it. */
function addToNew(name: string): Promise<void> {
  const id = book.value?.id
  if (!id) return Promise.resolve()
  return run(async () => {
    const made = await topics.createShelf(name)
    if (made === null) return
    await topics.setOnShelf(id, made, true)
    draft.value = ''
    suggestions.value = suggestions.value.filter((entry) => !sameTopic(entry, made))
  })
}

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <OverlayShell :title="title" @close="emit('close')">
    <div class="editor" data-testid="shelf-editor" :data-kind="current.kind">
      <!-- A new shelf: its name, and nothing else yet. -->
      <form v-if="current.kind === 'new'" class="name-row" @submit.prevent="makeShelf">
        <label class="grow">
          <span class="label">{{ t('shelves.rename') }}</span>
          <input
            ref="nameField"
            v-model="draft"
            type="text"
            maxlength="40"
            data-testid="shelf-name"
            :placeholder="t('shelves.newPlaceholder')"
          />
        </label>
        <button
          type="submit"
          class="btn-gold"
          data-testid="shelf-make"
          :disabled="busy || !draft.trim()"
        >
          {{ t('shelves.make') }}
        </button>
      </form>

      <!-- One shelf: its name, its books, its place in the list. -->
      <template v-else-if="current.kind === 'shelf'">
        <form class="name-row" @submit.prevent="rename">
          <label class="grow">
            <span class="label">{{ t('shelves.rename') }}</span>
            <input v-model="renameTo" type="text" maxlength="40" data-testid="shelf-rename" />
          </label>
          <button
            type="submit"
            :disabled="busy || !renameTo.trim() || renameTo.trim() === shelfName"
            data-testid="shelf-rename-save"
          >
            {{ t('shelves.save') }}
          </button>
        </form>

        <h2 class="label section">{{ t('shelves.books') }}</h2>
        <p v-if="library.books.length === 0" class="quiet">{{ t('library.emptyLine') }}</p>
        <ul class="checklist" data-testid="shelf-books">
          <li v-for="entry in library.sortedBooks" :key="entry.id">
            <label class="check">
              <input
                type="checkbox"
                :checked="hasTopic(entry, shelfName)"
                :disabled="busy"
                :data-testid="`shelf-book-${entry.id}`"
                @change="toggleBook(entry.id, checked($event))"
              />
              <BookThumb :cover="entry.coverBlob" />
              <span class="words">
                <span class="name">{{ entry.title }}</span>
                <span v-if="entry.author" class="sub">{{ entry.author }}</span>
              </span>
            </label>
          </li>
        </ul>

        <footer class="shelf-foot">
          <button type="button" :disabled="busy || position <= 0" @click="move(-1)">
            {{ t('shelves.moveUp') }}
          </button>
          <button
            type="button"
            :disabled="busy || position < 0 || position >= topics.topics.length - 1"
            @click="move(1)"
          >
            {{ t('shelves.moveDown') }}
          </button>
          <span class="spacer"></span>
          <button
            type="button"
            class="danger"
            data-testid="shelf-remove"
            :disabled="busy"
            @click="remove"
          >
            {{ confirmingRemove ? t('shelves.removeConfirm') : t('shelves.remove') }}
          </button>
        </footer>
      </template>

      <!-- One book: the shelves it stands on. -->
      <template v-else-if="book">
        <p class="book-line">
          <BookThumb :cover="book.coverBlob" />
          <span class="words">
            <span class="name">{{ book.title }}</span>
            <span v-if="book.author" class="sub">{{ book.author }}</span>
          </span>
        </p>
        <p v-if="topics.topics.length === 0" class="quiet">{{ t('shelves.noneYet') }}</p>
        <ul class="checklist" data-testid="book-shelves">
          <li v-for="topic in topics.topics" :key="topic">
            <label class="check">
              <input
                type="checkbox"
                :checked="hasTopic(book, topic)"
                :disabled="busy"
                :data-testid="`book-shelf-${topic}`"
                @change="toggleTopic(topic, checked($event))"
              />
              <span class="name">{{ topic }}</span>
            </label>
          </li>
        </ul>
        <form class="name-row" @submit.prevent="addToNew(draft)">
          <label class="grow">
            <span class="label">{{ t('shelves.new') }}</span>
            <input
              v-model="draft"
              type="text"
              maxlength="40"
              data-testid="book-new-shelf"
              :placeholder="t('shelves.newPlaceholder')"
            />
          </label>
          <button type="submit" :disabled="busy || !draft.trim()">{{ t('shelves.addNew') }}</button>
        </form>
        <template v-if="suggestions.length > 0">
          <h2 class="label section">{{ t('shelves.suggested') }}</h2>
          <p class="suggestions" data-testid="shelf-suggestions">
            <button
              v-for="name in suggestions"
              :key="name"
              type="button"
              class="suggestion"
              :disabled="busy"
              @click="addToNew(name)"
            >
              + {{ name }}
            </button>
          </p>
        </template>
      </template>

      <p class="done-row">
        <button type="button" data-testid="shelf-editor-done" @click="emit('close')">
          {{ t('shelves.done') }}
        </button>
      </p>
    </div>
  </OverlayShell>
</template>

<style scoped>
.label {
  display: block;
  margin-bottom: 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.section {
  margin: 1.3rem 0 0.5rem;
  font-weight: 400;
}
.name-row {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
  margin-top: 0.4rem;
}
.grow {
  flex: 1;
  min-width: 0;
}
.grow input {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-serif);
  font-size: 1rem;
}
.checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(22rem, 50vh);
  overflow-y: auto;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 2.75rem;
  padding: 0.2rem 0.3rem;
  border-bottom: 1px solid var(--hair-soft);
  cursor: pointer;
}
.check input {
  width: 1.05rem;
  height: 1.05rem;
  flex: none;
  accent-color: var(--gold);
}
.words {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.82rem;
  color: var(--text-faint);
}
.book-line {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 0.8rem;
}
.quiet {
  color: var(--text-faint);
  font-size: 0.85rem;
  margin: 0.4rem 0 0.8rem;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0;
}
.suggestion {
  text-transform: none;
  letter-spacing: 0;
  font-family: var(--font-serif);
  font-size: 0.92rem;
  border-style: dashed;
  border-color: var(--hair);
  color: var(--gold);
  border-radius: 1rem;
  padding: 0.3em 0.85em;
}
.shelf-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.1rem;
}
.spacer {
  flex: 1;
}
.danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.done-row {
  display: flex;
  justify-content: flex-end;
  margin: 1.2rem 0 0;
}
</style>
