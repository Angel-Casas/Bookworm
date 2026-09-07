<script setup lang="ts">
/**
 * Searching every book at once.
 *
 * A reader remembers a sentence, not which book it was in — so the answers are
 * grouped by what kind of answer they are, and every one of them is a door:
 * pressing it opens the book at the place the match is.
 *
 * The shelf answers from memory as you type. Reading inside the books is a
 * separate, slower thing, and it is asked for rather than assumed.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatCount } from '@/lib/format'
import { splitExcerpt, type ShelfBook, type ShelfHit } from '@/lib/shelfSearch'
import { useLanguageStore } from '@/stores/language'
import { useLibraryStore } from '@/stores/library'
import { useShelfSearchStore } from '@/stores/shelfSearch'
import { useI18n } from '@/i18n'
import OverlayShell from './OverlayShell.vue'
import IconLamp from '@/components/icons/IconLamp.vue'
import IconNote from '@/components/icons/IconNote.vue'
import IconQuill from '@/components/icons/IconQuill.vue'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const language = useLanguageStore()
const library = useLibraryStore()
const search = useShelfSearchStore()
const { t } = useI18n()

const field = ref<HTMLInputElement | null>(null)

const books = computed<ShelfBook[]>(() =>
  library.books.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
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

onMounted(() => {
  if (!library.loaded) void library.load()
  void search.loadMarks()
  field.value?.focus()
  field.value?.select()
})

// Typing a new question retires the old passages rather than leaving them to
// be read as answers to it.
watch(
  () => search.query,
  (value) => search.setQuery(value),
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
  <OverlayShell :title="t('shelf.title')" wide @close="emit('close')">
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
      <section v-if="bookHits.length > 0" class="group" data-testid="hits-books">
        <h2>{{ t('shelf.books') }}</h2>
        <button
          v-for="hit in bookHits"
          :key="hit.id"
          type="button"
          class="hit"
          data-hit-kind="book"
          @click="open(hit)"
        >
          <span class="excerpt">
            <span>{{ splitExcerpt(hit)[0] }}</span
            ><mark>{{ splitExcerpt(hit)[1] }}</mark
            ><span>{{ splitExcerpt(hit)[2] }}</span>
          </span>
          <span v-if="hit.where" class="where">{{ hit.where }}</span>
        </button>
      </section>

      <section v-if="markHits.length > 0" class="group" data-testid="hits-marks">
        <h2>{{ t('shelf.marks') }}</h2>
        <button
          v-for="hit in markHits"
          :key="hit.id"
          type="button"
          class="hit"
          data-hit-kind="mark"
          @click="open(hit)"
        >
          <span class="excerpt">
            <IconQuill
              v-if="hit.markType === 'highlight'"
              class="tag"
              tint="#f2dd88"
              aria-hidden="true"
            />
            <IconNote v-else-if="hit.markType === 'note'" class="tag" aria-hidden="true" />
            <IconLamp v-else class="tag" :lit="true" aria-hidden="true" />
            <span>{{ splitExcerpt(hit)[0] }}</span
            ><mark>{{ splitExcerpt(hit)[1] }}</mark
            ><span>{{ splitExcerpt(hit)[2] }}</span>
          </span>
          <span class="where">{{ hit.bookTitle }} · {{ hit.where }}</span>
        </button>
      </section>

      <section v-if="passageHits.length > 0" class="group" data-testid="hits-passages">
        <h2>{{ t('shelf.passages') }}</h2>
        <button
          v-for="hit in passageHits"
          :key="hit.id"
          type="button"
          class="hit"
          data-hit-kind="passage"
          @click="open(hit)"
        >
          <span class="excerpt">
            <span>{{ splitExcerpt(hit)[0] }}</span
            ><mark>{{ splitExcerpt(hit)[1] }}</mark
            ><span>{{ splitExcerpt(hit)[2] }}</span>
          </span>
          <span class="where">{{ hit.bookTitle }} · {{ hit.where }}</span>
        </button>
      </section>

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
.group {
  margin-top: 1.1rem;
}
.group h2 {
  margin: 0 0 0.45rem;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}
/* A hit is a door, so it is a whole-width target with the words on top and
   the place underneath — the same shape as a line in the marks panel. */
.hit {
  display: block;
  width: 100%;
  text-align: start;
  padding: 0.5em 0.6em;
  margin-bottom: 0.25rem;
  border: 1px solid transparent;
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
  display: block;
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
