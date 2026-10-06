<script setup lang="ts">
/**
 * Searching every book at once.
 *
 * A reader remembers a sentence, not which book it was in. So the answers come
 * in two panes: on the left, the books that hold an answer — filed on the same
 * shelves as the library, each with how many answers it holds — and on the
 * right, everything found in the one chosen. Every answer is a door: pressing
 * it opens the book at the place the match is.
 *
 * On a phone the two panes take turns: the list, then a book's answers with a
 * way back.
 *
 * The shelf answers from memory as you type. Reading inside the books is a
 * separate, slower thing, and it is asked for rather than assumed.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatCount } from '@/lib/format'
import { shelveHits, splitExcerpt, type ShelfBook, type ShelfHit } from '@/lib/shelfSearch'
import { useLanguageStore } from '@/stores/language'
import { useLibraryStore } from '@/stores/library'
import { useShelfSearchStore } from '@/stores/shelfSearch'
import { useTopicsStore } from '@/stores/topics'
import { useI18n } from '@/i18n'
import OverlayShell from './OverlayShell.vue'
import IconLamp from '@/components/icons/IconLamp.vue'
import IconNote from '@/components/icons/IconNote.vue'
import IconQuill from '@/components/icons/IconQuill.vue'
import BookThumb from '@/components/shelves/BookThumb.vue'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const language = useLanguageStore()
const library = useLibraryStore()
const search = useShelfSearchStore()
const topics = useTopicsStore()
const { t } = useI18n()

const field = ref<HTMLInputElement | null>(null)

const books = computed<ShelfBook[]>(() =>
  library.sortedBooks.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    topics: book.topics,
  })),
)

const instant = computed(() => search.results(books.value))
const bookHits = computed(() => instant.value.filter((hit) => hit.kind === 'book'))
const markHits = computed(() => instant.value.filter((hit) => hit.kind === 'mark'))
const passageHits = computed(() => search.passagesForQuery)

const nothingYet = computed(
  () =>
    search.canGoDeep &&
    bookHits.value.length === 0 &&
    markHits.value.length === 0 &&
    passageHits.value.length === 0 &&
    !search.deepRunning,
)

/** Every answer, filed: shelves on the left, a book's answers on the right. */
const shelves = computed(() =>
  shelveHits(
    books.value,
    [...bookHits.value, ...markHits.value, ...passageHits.value],
    topics.topics,
  ),
)
const foundBooks = computed(() => {
  const seen = new Map<string, (typeof shelves.value)[number]['books'][number]>()
  for (const shelf of shelves.value) for (const entry of shelf.books) seen.set(entry.book.id, entry)
  return [...seen.values()]
})
const placeCount = computed(() => foundBooks.value.reduce((n, entry) => n + entry.hits.length, 0))

/**
 * The book whose answers are on the right. The reader's pick while it is still
 * among the answers; otherwise the first book, so the right pane is never
 * empty while there is something to show.
 */
const picked = ref<string | null>(null)
const chosen = computed(
  () =>
    foundBooks.value.find((entry) => entry.book.id === picked.value) ?? foundBooks.value[0] ?? null,
)
const chosenMeta = computed(() =>
  chosen.value ? (library.books.find((book) => book.id === chosen.value?.book.id) ?? null) : null,
)
/** On a phone: true once a book has been tapped, until "back". */
const showingBook = ref(false)

function pick(bookId: string): void {
  picked.value = bookId
  showingBook.value = true
}

function coverOf(bookId: string): Blob | null {
  return library.books.find((book) => book.id === bookId)?.coverBlob ?? null
}

onMounted(() => {
  if (!library.loaded) void library.load()
  void topics.load()
  void search.loadMarks()
  field.value?.focus()
  field.value?.select()
})

// Typing a new question retires the old passages rather than leaving them to
// be read as answers to it.
watch(
  () => search.query,
  (value) => {
    search.setQuery(value)
    showingBook.value = false
  },
)

function open(hit: ShelfHit): void {
  const query: Record<string, string> = {}
  if (hit.position) query.at = hit.position
  // A passage is found by its words, so the book can land on the words
  // themselves rather than at the top of the chapter that holds them.
  if (hit.kind === 'passage') query.q = search.query.trim()
  void router.push({ name: 'reader', params: { id: hit.bookId }, query })
  emit('close')
}

const progress = computed(() =>
  search.deepTotal > 0
    ? t('shelf.progress', {
        done: formatCount(search.deepDone, language.code),
        count: search.deepTotal,
      })
    : '',
)
</script>

<template>
  <OverlayShell :title="t('shelf.title')" widest @close="emit('close')">
    <label class="field">
      <span class="sr-only">{{ t('shelf.label') }}</span>
      <input
        ref="field"
        v-model="search.query"
        type="search"
        data-testid="shelf-search-input"
        :placeholder="t('shelf.placeholder')"
        autocomplete="off"
        spellcheck="false"
      />
    </label>

    <p v-if="!search.canGoDeep" class="hint">{{ t('shelf.hint') }}</p>

    <template v-else>
      <p v-if="foundBooks.length > 0" class="summary" data-testid="shelf-search-summary">
        {{ t('shelf.summaryBooks', { count: foundBooks.length }) }}
        ·
        {{ t('shelf.found', { count: placeCount }) }}
      </p>

      <div
        v-if="foundBooks.length > 0"
        class="panes"
        :class="{ 'showing-book': showingBook }"
        data-testid="shelf-search-panes"
      >
        <!-- Left: the books that hold an answer, on their shelves. -->
        <nav class="list" :aria-label="t('shelf.booksFound')">
          <section
            v-for="shelf in shelves"
            :key="shelf.topic ?? '\u0000loose'"
            class="list-shelf"
            data-testid="search-shelf"
          >
            <h2 v-if="shelf.topic !== null || shelves.length > 1" class="list-topic">
              <span>{{ shelf.topic ?? t('shelves.loose') }}</span>
              <span class="n">{{ formatCount(shelf.books.length, language.code) }}</span>
            </h2>
            <button
              v-for="entry in shelf.books"
              :key="entry.book.id"
              type="button"
              class="book-row"
              data-testid="search-book"
              :data-book="entry.book.id"
              :aria-current="chosen?.book.id === entry.book.id ? 'true' : undefined"
              @click="pick(entry.book.id)"
            >
              <BookThumb :cover="coverOf(entry.book.id)" />
              <span class="row-words">
                <span class="row-title">{{ entry.book.title }}</span>
                <span v-if="entry.book.author" class="row-author">{{ entry.book.author }}</span>
              </span>
              <span class="n badge">{{ formatCount(entry.hits.length, language.code) }}</span>
            </button>
          </section>
        </nav>

        <!-- Right: everything found in the chosen book. -->
        <section
          v-if="chosen"
          class="detail"
          data-testid="search-detail"
          :data-book="chosen.book.id"
        >
          <button type="button" class="back" data-testid="search-back" @click="showingBook = false">
            ← {{ t('shelf.back') }}
          </button>
          <header class="detail-head">
            <BookThumb :cover="chosenMeta?.coverBlob ?? null" class="detail-cover" />
            <div>
              <h2 class="detail-title">{{ chosen.book.title }}</h2>
              <p class="detail-sub">
                <span v-if="chosen.book.author">{{ chosen.book.author }}</span>
                <span v-if="chosen.topics && chosen.topics.length > 0">
                  · {{ chosen.topics.join(' · ') }}</span
                >
              </p>
              <p class="detail-count">
                {{ t('shelf.found', { count: chosen.hits.length }) }}
              </p>
            </div>
          </header>
          <button
            v-for="hit in chosen.hits"
            :key="hit.id"
            type="button"
            class="hit"
            :data-hit-kind="hit.kind"
            @click="open(hit)"
          >
            <span class="kind">
              <template v-if="hit.kind === 'book'">{{ t('shelf.kindBook') }}</template>
              <template v-else-if="hit.kind === 'mark'">
                <IconQuill
                  v-if="hit.markType === 'highlight'"
                  class="tag"
                  tint="#f2dd88"
                  aria-hidden="true"
                />
                <IconNote v-else-if="hit.markType === 'note'" class="tag" aria-hidden="true" />
                <IconLamp v-else class="tag" :lit="true" aria-hidden="true" />
                {{ t('shelf.kindMark') }}
              </template>
              <template v-else>{{ t('shelf.kindPassage') }}</template>
              <span v-if="hit.kind !== 'book' && hit.where" class="where">{{ hit.where }}</span>
            </span>
            <span class="excerpt">
              <span>{{ splitExcerpt(hit)[0] }}</span
              ><mark>{{ splitExcerpt(hit)[1] }}</mark
              ><span>{{ splitExcerpt(hit)[2] }}</span>
            </span>
          </button>
        </section>
      </div>

      <p v-if="nothingYet" class="hint" data-testid="shelf-search-empty">
        {{ t('shelf.nothing') }}
      </p>

      <!-- Reading every book is the slow answer, so it is offered rather than
           taken. It reports as it goes: a wait a reader can watch is a wait a
           reader will sit through. -->
      <footer class="deep">
        <button
          type="button"
          class="deep-btn"
          data-testid="shelf-search-deep"
          :disabled="search.deepRunning || books.length === 0"
          @click="search.goDeep(books)"
        >
          {{ search.deepRunning ? t('shelf.deepRunning') : t('shelf.deep') }}
        </button>
        <span v-if="search.deepTotal > 0" class="progress" data-testid="shelf-search-progress">
          {{ progress }}
        </span>
      </footer>
      <p v-if="search.failed.length > 0" class="hint failed">
        {{ t('shelf.unreadable', { titles: search.failed.join(', ') }) }}
      </p>
    </template>
  </OverlayShell>
</template>

<style scoped>
.field input {
  width: 100%;
  padding: 0.65em 0.8em;
  font-family: var(--font-serif);
  font-size: 1rem;
}
.hint {
  margin: 0.9rem 0 0;
  color: var(--text-faint);
  font-size: 0.8rem;
  line-height: 1.55;
}
.hint.failed {
  color: var(--text-dim);
}
.summary {
  margin: 0.8rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}
/*
 * Two panes: the books on the left, one book's answers on the right. Each
 * scrolls on its own, so a long list of books never pushes the answers off
 * screen.
 */
.panes {
  display: grid;
  grid-template-columns: minmax(13rem, 18rem) minmax(0, 1fr);
  margin-top: 0.8rem;
  border-top: 1px solid var(--hair-soft);
  border-bottom: 1px solid var(--hair-soft);
  height: min(32rem, 62vh);
}
.list {
  overflow-y: auto;
  border-inline-end: 1px solid var(--hair-soft);
  padding: 0.4rem 0;
}
.list-topic {
  display: flex;
  justify-content: space-between;
  margin: 0.7rem 0.9rem 0.25rem;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.72rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
}
.book-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  min-height: 2.9rem;
  padding: 0.3rem 0.9rem;
  border: 0;
  border-radius: 0;
  background: none;
  text-align: start;
  text-transform: none;
  letter-spacing: 0;
}
.book-row:hover:not(:disabled) {
  border: 0;
  background: var(--bg-raise);
}
.book-row[aria-current='true'] {
  background: var(--bg-raise);
  box-shadow: inset 3px 0 0 var(--gold);
}
.row-words {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.row-title {
  font-family: var(--font-serif);
  font-size: 0.98rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-author {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.78rem;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.n {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--text-faint);
}
.badge {
  flex: none;
  min-width: 1.4rem;
  text-align: center;
  padding: 0.15em 0.45em;
  border-radius: 1rem;
  background: var(--gold-deep);
  color: var(--gold-ink);
}
.book-row[aria-current='true'] .badge {
  background: var(--gold);
}
.detail {
  overflow-y: auto;
  padding: 1rem 1.2rem;
}
.detail-head {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  padding-bottom: 0.8rem;
}
.detail-cover {
  width: 3.4rem;
}
.detail-title {
  margin: 0;
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: 1.3rem;
  color: var(--text);
}
.detail-sub {
  margin: 0.1rem 0 0;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.88rem;
  color: var(--text-faint);
}
.detail-count {
  margin: 0.35rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gold-mid);
}
.kind {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.2rem;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gold-mid);
}
.kind .where {
  margin: 0;
  letter-spacing: 0.06em;
  text-transform: none;
}
/* The way back to the list exists only where the list is out of sight. */
.back {
  display: none;
  margin-bottom: 0.8rem;
}
/* A phone: the panes take turns rather than sitting side by side. */
@media (max-width: 40rem) {
  .panes {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    max-height: none;
  }
  .list {
    border-inline-end: 0;
  }
  .detail {
    display: none;
    padding: 0.9rem 0.2rem;
  }
  .panes.showing-book .list {
    display: none;
  }
  .panes.showing-book .detail {
    display: block;
  }
  .back {
    display: inline-block;
  }
}
/* A hit is a door, so it is a whole-width target with the words on top and
   the place underneath — the same shape as a line in the marks panel. */
.hit {
  display: block;
  width: 100%;
  text-align: start;
  padding: 0.7em 0.6em;
  margin-bottom: 0.25rem;
  border: 1px solid transparent;
  border-top-color: var(--hair-soft);
  background: none;
  text-transform: none;
  letter-spacing: 0;
  font: inherit;
}
.hit:hover,
.hit:focus-visible {
  border-color: var(--hair-soft);
  background: none;
}
.excerpt {
  display: block;
  color: var(--text-dim);
  font-family: var(--font-serif);
  font-size: 0.92rem;
  line-height: 1.5;
}
.excerpt mark {
  background: none;
  color: var(--gold);
  font-weight: 600;
}
.tag {
  width: 14px;
  height: 15px;
  margin-inline-end: 0.35rem;
  vertical-align: -2px;
  color: var(--gold-mid);
}
.where {
  display: inline;
  margin-top: 0.15rem;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
}
.deep {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 1.2rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--hair-soft);
}
.deep-btn {
  font-size: 0.6rem;
}
.progress {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 0.6rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
