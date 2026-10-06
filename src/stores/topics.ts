/**
 * Shelves by topic: the reader's list of shelves, and which books stand on them.
 *
 * The list itself (order, and shelves still waiting for their first book) is
 * user data and lives in IndexedDB. Which shelves a book is on is part of the
 * book's own record, written through the library store so no two writers ever
 * hold separate copies of a book.
 *
 * How the shelf is arranged, and which shelves are folded away, are
 * preferences — localStorage, like the view and the sort.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  allTopics,
  groupByTopic,
  hasTopic,
  normalizeTopic,
  renameInOrder,
  renamedTopic,
  sameTopic,
  topicKey,
  topicSuggestions,
  withTopic,
  withoutTopic,
} from '@/lib/topics'
import { getBookFile, getShelfOrder, saveShelfOrder } from '@/services/db'
import { readBookSubjects } from '@/services/bookSubjects'
import { useLibraryStore } from '@/stores/library'

export type LibraryArrange = 'topics' | 'all'

const ARRANGE_KEY = 'bookworm.libraryArrange.v1'
const FOLDED_KEY = 'bookworm.foldedShelves.v1'

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the preference holds for this visit only.
  }
}

function readFolded(): string[] {
  try {
    const parsed: unknown = JSON.parse(readPref(FOLDED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The key the loose shelf (books on no shelf) is folded under. */
export const LOOSE_SHELF = '\u0000loose'

export const useTopicsStore = defineStore('topics', () => {
  const library = useLibraryStore()
  const order = ref<string[]>([])
  const loaded = ref(false)
  /** By topic unless the reader has said otherwise. */
  const arrange = ref<LibraryArrange>(readPref(ARRANGE_KEY) === 'all' ? 'all' : 'topics')
  const folded = ref<string[]>(readFolded())

  /** Every shelf, in the reader's order. */
  const topics = computed(() => allTopics(library.books, order.value))
  /**
   * The shelf is grouped only when there is something to group by: a new
   * reader with no shelves sees their books, not one shelf called "No topic".
   */
  const grouped = computed(() => arrange.value === 'topics' && topics.value.length > 0)
  const shelves = computed(() => groupByTopic(library.sortedBooks, topics.value))

  async function load(): Promise<void> {
    if (loaded.value) return
    loaded.value = true
    order.value = await getShelfOrder().catch(() => [])
  }

  async function persistOrder(next: string[]): Promise<void> {
    order.value = next
    await saveShelfOrder(next)
  }

  function setArrange(value: LibraryArrange): void {
    arrange.value = value
    writePref(ARRANGE_KEY, value)
  }

  function isFolded(topic: string | null): boolean {
    const key = topic === null ? LOOSE_SHELF : topicKey(topic)
    return folded.value.includes(key)
  }

  function toggleFold(topic: string | null): void {
    const key = topic === null ? LOOSE_SHELF : topicKey(topic)
    folded.value = folded.value.includes(key)
      ? folded.value.filter((entry) => entry !== key)
      : [...folded.value, key]
    writePref(FOLDED_KEY, JSON.stringify(folded.value))
  }

  /**
   * Make a shelf. Returns its name as stored — the existing spelling when one
   * by that name is already there — or null for a blank name.
   */
  async function createShelf(raw: string): Promise<string | null> {
    const name = normalizeTopic(raw)
    if (name === null) return null
    const existing = topics.value.find((topic) => sameTopic(topic, name))
    if (existing) return existing
    // The list is written out in full: a shelf that only books knew about
    // until now is pinned in its place rather than left to the alphabet.
    await persistOrder([...topics.value, name])
    // Making a shelf is asking for shelves.
    if (arrange.value !== 'topics') setArrange('topics')
    return name
  }

  async function renameShelf(from: string, raw: string): Promise<void> {
    const to = normalizeTopic(raw)
    if (to === null || from === to) return
    for (const book of library.books.filter((candidate) => hasTopic(candidate, from))) {
      await library.patchBook(book.id, { topics: renamedTopic(book.topics, from, to) })
    }
    await persistOrder(renameInOrder(topics.value, from, to))
  }

  /** Take the shelf down. The books stay; they are only no longer on it. */
  async function removeShelf(name: string): Promise<void> {
    for (const book of library.books.filter((candidate) => hasTopic(candidate, name))) {
      await library.patchBook(book.id, { topics: withoutTopic(book.topics, name) })
    }
    await persistOrder(topics.value.filter((topic) => !sameTopic(topic, name)))
  }

  /** Move a shelf one place up or down the list. */
  async function moveShelf(name: string, by: -1 | 1): Promise<void> {
    const list = [...topics.value]
    const at = list.findIndex((topic) => sameTopic(topic, name))
    const to = at + by
    if (at < 0 || to < 0 || to >= list.length) return
    const [moved] = list.splice(at, 1)
    if (moved !== undefined) list.splice(to, 0, moved)
    await persistOrder(list)
  }

  /** Put a book on a shelf, or take it off. */
  async function setOnShelf(bookId: string, topic: string, on: boolean): Promise<void> {
    const book = library.books.find((candidate) => candidate.id === bookId)
    if (!book) return
    const next = on ? withTopic(book.topics, topic) : withoutTopic(book.topics, topic)
    await library.patchBook(bookId, { topics: next })
  }

  /** Shelf names the book's own file suggests, minus the ones it is on. */
  async function suggestionsFor(bookId: string): Promise<string[]> {
    const book = library.books.find((candidate) => candidate.id === bookId)
    if (!book) return []
    const blob = await getBookFile(bookId).catch(() => undefined)
    if (!blob) return []
    return topicSuggestions(await readBookSubjects(blob, book.format), book.topics ?? [])
  }

  return {
    order,
    loaded,
    arrange,
    topics,
    grouped,
    shelves,
    load,
    setArrange,
    isFolded,
    toggleFold,
    createShelf,
    renameShelf,
    removeShelf,
    moveShelf,
    setOnShelf,
    suggestionsFor,
  }
})
