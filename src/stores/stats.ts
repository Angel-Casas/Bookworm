/** Reading time and page-turn statistics per book. */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  getReadingStats,
  listReadingStats,
  putReadingStats,
  type ReadingStats,
} from '@/services/db'

export const useStatsStore = defineStore('stats', () => {
  const byBook = ref<Record<string, ReadingStats>>({})
  const loaded = ref(false)

  function statsFor(bookId: string): ReadingStats | null {
    return byBook.value[bookId] ?? null
  }

  async function load(): Promise<void> {
    if (loaded.value) return
    const all = await listReadingStats().catch(() => [])
    byBook.value = Object.fromEntries(all.map((stats) => [stats.bookId, stats]))
    loaded.value = true
  }

  /** Merge one reading session into a book's totals. */
  async function addSession(bookId: string, seconds: number, pageTurns: number): Promise<void> {
    if (seconds <= 0 && pageTurns <= 0) return
    const now = Date.now()
    const current = (await getReadingStats(bookId).catch(() => undefined)) ?? {
      bookId,
      readingSeconds: 0,
      pageTurns: 0,
      firstReadAt: null,
      lastReadAt: null,
    }
    const updated: ReadingStats = {
      bookId,
      readingSeconds: current.readingSeconds + Math.max(0, seconds),
      pageTurns: current.pageTurns + Math.max(0, pageTurns),
      firstReadAt: current.firstReadAt ?? now,
      lastReadAt: now,
    }
    await putReadingStats(updated).catch(() => undefined)
    byBook.value = { ...byBook.value, [bookId]: updated }
  }

  return { byBook, loaded, statsFor, load, addSession }
})
