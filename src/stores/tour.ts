/**
 * Running the tour: where it is, and the one book it brought with it.
 *
 * Deliberately ignorant of routing. The tour knows which LEG each step belongs
 * to — the shelf or inside a book — and the component watching it does the
 * navigating. That keeps the store testable and stops two things from both
 * believing they are in charge of the address bar.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { TOUR_STEPS, type TourStep } from '@/lib/tour'
import { importSampleBook, SAMPLE_KEYS } from '@/services/sampleBook'
import { isRtl } from '@/lib/language'
import { saveBook } from '@/services/db'
import { translateIn } from '@/i18n'
import { useLanguageStore } from '@/stores/language'
import { useLibraryStore } from '@/stores/library'

/** Set once the tour has run to the end or been left early: it is offered
 *  once, and after that it lives in settings. */
const SEEN_KEY = 'bookworm.tourSeen.v1'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the tour will offer itself again next visit, which
    // is a smaller annoyance than refusing to run it at all.
  }
}

export const useTourStore = defineStore('tour', () => {
  const seen = ref(read(SEEN_KEY) !== null)
  const active = ref(false)
  const index = ref(0)
  /** The book the tour brought, so the reader leg knows which one to open. */
  const bookId = ref<string | null>(null)
  /** True while the sample book is being built and imported. */
  const preparing = ref(false)

  const step = computed<TourStep | null>(() => (active.value ? (TOUR_STEPS[index.value] ?? null) : null))
  const total = TOUR_STEPS.length
  const isLast = computed(() => index.value >= total - 1)

  /**
   * Make sure there is something to point at.
   *
   * A reader who already has books does not need ours — the tour is about the
   * app, and their own shelf shows it better than a sample would.
   */
  async function ensureBook(): Promise<void> {
    const library = useLibraryStore()
    if (!library.loaded) await library.load()
    if (library.books.length > 0) {
      bookId.value = library.sortedBooks[0]?.id ?? null
      return
    }
    preparing.value = true
    try {
      const language = useLanguageStore()
      const words: Record<string, string> = {}
      for (const key of SAMPLE_KEYS) {
        words[key] = translateIn(language.code, key as never)
      }
      const { meta, blob } = await importSampleBook({
        words,
        language: language.code,
        dir: isRtl(language.code) ? 'rtl' : 'ltr',
      })
      await saveBook(meta, blob)
      library.books.push(meta)
      bookId.value = meta.id
    } catch {
      // No sample book is not a reason to refuse the tour: the steps that
      // point at a book will simply find nothing and be skipped.
      bookId.value = null
    } finally {
      preparing.value = false
    }
  }

  async function start(): Promise<void> {
    index.value = 0
    active.value = true
    await ensureBook()
  }

  function next(): void {
    if (index.value < total - 1) index.value += 1
    else finish()
  }

  function back(): void {
    if (index.value > 0) index.value -= 1
  }

  /** Jump past a step whose target never appeared — see TourGuide. */
  function skipStep(): void {
    if (index.value < total - 1) index.value += 1
    else finish()
  }

  /** Left early or run to the end: either way it does not open itself again. */
  function finish(): void {
    active.value = false
    index.value = 0
    seen.value = true
    write(SEEN_KEY, 'seen')
  }

  return { seen, active, index, total, step, isLast, bookId, preparing, start, next, back, skipStep, finish }
})
