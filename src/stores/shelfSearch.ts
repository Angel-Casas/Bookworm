/**
 * The shelf-wide search: what it knows already, and what it has to go and read.
 *
 * The instant half — titles, authors, marks — is pure and answers on every
 * keystroke. The deep half opens every book file and pulls its text out, which
 * takes seconds per book, so it happens only when asked and reports as it
 * goes: a reader watching a progress line accepts a wait that a frozen box
 * does not.
 *
 * Extracted text is cached by `getBookSections` for the session, so the second
 * deep search of a shelf is fast.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { searchSections } from '@/lib/search'
import {
  passageHits,
  searchShelfMeta,
  shelfNeedle,
  type ShelfBook,
  type ShelfHit,
} from '@/lib/shelfSearch'
import { getBookFile, listAnnotations } from '@/services/db'
import { getBookSections } from '@/services/bookText'
import type { Annotation } from '@/lib/types'

export const useShelfSearchStore = defineStore('shelfSearch', () => {
  const query = ref('')
  /** Every mark on the shelf, loaded once — the per-book store only holds the
   *  books that have been opened. */
  const allMarks = ref<Annotation[]>([])
  const marksLoaded = ref(false)

  /** Passages found by the last deep search, and what it is doing now. */
  const passages = ref<ShelfHit[]>([])
  const searchedFor = ref('')
  const deepRunning = ref(false)
  const deepDone = ref(0)
  const deepTotal = ref(0)
  const failed = ref<string[]>([])
  let generation = 0

  async function loadMarks(): Promise<void> {
    if (marksLoaded.value) return
    marksLoaded.value = true
    allMarks.value = await listAnnotations().catch(() => [])
  }

  function results(books: readonly ShelfBook[]): ShelfHit[] {
    return searchShelfMeta(books, allMarks.value, query.value)
  }

  /** Passages are only shown while they still answer what is in the box. */
  const passagesForQuery = computed(() =>
    searchedFor.value === query.value.trim().toLowerCase() ? passages.value : [],
  )

  /** True when the reader has typed something the deep search could answer. */
  const canGoDeep = computed(() => shelfNeedle(query.value) !== null)

  function reset(): void {
    generation += 1
    deepRunning.value = false
    passages.value = []
    searchedFor.value = ''
    failed.value = []
    deepDone.value = 0
    deepTotal.value = 0
  }

  /**
   * Read every book on the shelf and search its text.
   *
   * One book at a time on purpose: extraction is heavy, and doing eight at
   * once on a phone is how a page stops responding. Results appear per book,
   * so the first answer arrives long before the last book is opened.
   */
  async function goDeep(books: readonly ShelfBook[]): Promise<void> {
    const needle = shelfNeedle(query.value)
    if (needle === null || deepRunning.value) return
    const mine = ++generation
    deepRunning.value = true
    searchedFor.value = needle
    passages.value = []
    failed.value = []
    deepDone.value = 0
    deepTotal.value = books.length

    for (const book of books) {
      // The reader typed on, or closed the search: this answer is stale.
      if (mine !== generation) return
      try {
        const blob = await getBookFile(book.id)
        if (!blob) continue
        const sections = await getBookSections(book.id, book.format, blob)
        if (mine !== generation) return
        const found = passageHits(book, searchSections(sections, needle))
        if (found.length > 0) passages.value = [...passages.value, ...found]
      } catch {
        // A book whose text cannot be read is named, not swallowed — the
        // reader deserves to know their search did not cover everything.
        failed.value = [...failed.value, book.title]
      } finally {
        if (mine === generation) deepDone.value += 1
      }
    }
    if (mine === generation) deepRunning.value = false
  }

  function setQuery(value: string): void {
    query.value = value
    // A new question makes the old answers stale, but keep them on screen
    // until they no longer match — passagesForQuery does that quietly.
    if (shelfNeedle(value) === null) reset()
  }

  return {
    query,
    allMarks,
    passages,
    passagesForQuery,
    deepRunning,
    deepDone,
    deepTotal,
    failed,
    canGoDeep,
    loadMarks,
    results,
    goDeep,
    setQuery,
    reset,
  }
})
