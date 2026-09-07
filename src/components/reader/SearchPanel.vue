<script setup lang="ts">
import { ref } from 'vue'
import IconClose from '@/components/icons/IconClose.vue'
import { useI18n } from '@/i18n'
import { searchSections, type SearchMatch } from '@/lib/search'
import { getBookSections } from '@/services/bookText'
import type { BookMeta } from '@/lib/types'

const props = defineProps<{ book: BookMeta; blob: Blob }>()
const { t } = useI18n()

const emit = defineEmits<{
  jump: [position: string, term: string]
  close: []
}>()

const query = ref('')
const lastQuery = ref('')
const results = ref<SearchMatch[]>([])
const searching = ref(false)
const searched = ref(false)
const error = ref<string | null>(null)

async function runSearch(): Promise<void> {
  const text = query.value.trim()
  if (text.length < 2 || searching.value) return
  searching.value = true
  error.value = null
  try {
    const sections = await getBookSections(props.book.id, props.book.format, props.blob)
    results.value = searchSections(sections, text)
    lastQuery.value = text
    searched.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('search.failed')
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <aside class="search-panel" data-testid="search-panel" aria-label="Search in book">
    <header>
      <strong>{{ t('search.title') }}</strong>
      <button
        type="button"
        class="x-btn panel-close"
        :aria-label="t('search.close')"
        :title="t('overlay.close')"
        @click="emit('close')"
      >
        <IconClose class="x-icon" aria-hidden="true" />
      </button>
    </header>
    <form class="search-form" @submit.prevent="runSearch">
      <input
        v-model="query"
        type="search"
        :placeholder="t('search.placeholder')"
        :aria-label="t('search.label')"
        data-testid="search-input"
      />
      <button type="submit" :disabled="searching" data-testid="search-go">
        {{ searching ? t('search.searching') : t('search.go') }}
      </button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="searched && results.length === 0" class="empty">
      {{ t('search.noMatches') }}
    </p>
    <ul v-else class="results" data-testid="search-results">
      <li v-for="(match, index) in results" :key="index">
        <button type="button" class="result" @click="emit('jump', match.position, lastQuery)">
          <span class="where">{{ match.sectionLabel }}</span>
          <span class="excerpt">
            {{ match.excerpt.slice(0, match.matchStart)
            }}<mark>{{ match.excerpt.slice(match.matchStart, match.matchEnd) }}</mark
            >{{ match.excerpt.slice(match.matchEnd) }}
          </span>
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.search-panel {
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
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.search-form {
  display: flex;
  gap: 0.5rem;
}
/* Same handmade cross that closes every other panel. */
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
.search-form input {
  flex: 1;
}
.results {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.result {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 100%;
  text-align: start;
  background: none;
  border: none;
  border-bottom: 1px solid var(--hair-soft);
  padding: 0.3rem 0;
  cursor: pointer;
  /* A result is a <button>, so it inherits the app's mono small-caps chrome
     styling. `font: inherit` doesn't undo tracking or case — and a passage of
     prose set in wide-tracked uppercase is a wall, not a quote. */
  font: inherit;
  text-transform: none;
  letter-spacing: normal;
}
.result:hover .where {
  text-decoration: underline;
}
.where {
  font-size: 0.8rem;
  /* Result titles carry the page's own ink, so they stay legible in both
     themes — a dim grey vanished against the dark panel. */
  color: var(--text);
  font-weight: 600;
}
.excerpt {
  font-size: 0.85rem;
  /* Was a hardcoded #333: near-invisible on the dark panel. */
  color: var(--text);
}
.excerpt mark {
  background: #ffe66d;
  /* The wash is always pale, so its text must always be dark. */
  color: #1b1508;
  padding: 0 1px;
}
.error {
  color: var(--danger);
}
.empty {
  color: var(--text-faint);
  font-size: 0.9rem;
}
</style>
