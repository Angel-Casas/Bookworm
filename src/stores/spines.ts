/**
 * The spines on the shelf: one made from every cover, and a painted one for
 * the books the reader paid to have painted.
 *
 * A made spine costs nothing and is worked out on the device the first time
 * the shelf meets a cover, then held for the session (it is quick to redo and
 * would go stale the moment a cover is backfilled). A painted spine is bought
 * from NanoGPT with the reader's own key, kept in IndexedDB, counted in the
 * spend like any other request, and travels in backups.
 */
import { reactive, ref, shallowReactive } from 'vue'
import { defineStore } from 'pinia'
import { describeFailure } from '@/lib/failure'
import { expectedCost, spineModel } from '@/lib/spineArt'
import type { Motif, SpineColors } from '@/lib/spine'
import type { BookMeta } from '@/lib/types'
import { failureWordsIn } from '@/i18n/bundles'
import { translateIn } from '@/i18n'
import * as db from '@/services/db'
import { NanoGptError } from '@/services/nanogpt'
import { fetchListedPrice, NoImageError, paintSpine } from '@/services/spineArt'
import { coverDataUrl, readCover, readPaintedSpine, shrinkSpine } from '@/services/spinePixels'
import { useLanguageStore } from '@/stores/language'
import { useSettingsStore } from '@/stores/settings'
import { useSpendStore } from '@/stores/spend'

export interface MadeSpine {
  colors: SpineColors
  motif: Motif | null
}

export interface PaintedSpine {
  url: string
  colors: SpineColors
  modelId: string
}

interface KeptSpine extends PaintedSpine {
  record: db.SpineRecord
}

export const useSpinesStore = defineStore('spines', () => {
  /** By book id. `blob` is the cover it was read from, so a new cover is read again. */
  const made = shallowReactive(new Map<string, MadeSpine & { blob: Blob }>())
  /** Every painted spine the reader owns, shown or set aside. */
  const painted = shallowReactive(new Map<string, KeptSpine>())
  const listed = reactive(new Map<string, number | null>())
  /** The paint run under way: which book, and how far through the run. */
  const painting = ref<{ bookId: string; done: number; total: number } | null>(null)
  const failure = ref<string | null>(null)
  let loaded = false
  let reading: Promise<void> = Promise.resolve()

  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    for (const record of await db.listSpines()) await remember(record)
  }

  async function remember(record: db.SpineRecord): Promise<void> {
    try {
      const colors = await readPaintedSpine(record.blob)
      const previous = painted.get(record.bookId)
      if (previous) URL.revokeObjectURL(previous.url)
      painted.set(record.bookId, {
        url: URL.createObjectURL(record.blob),
        colors,
        modelId: record.modelId,
        record,
      })
    } catch (error) {
      console.warn('[bookworm] a painted spine could not be read', record.bookId, error)
    }
  }

  /**
   * Make the spines for these books, one cover at a time, so a large library
   * does not decode two hundred covers at once on arrival. Queued: a second
   * call waits for the first instead of reading the same covers twice.
   */
  function makeFor(books: readonly BookMeta[]): Promise<void> {
    reading = reading.then(async () => {
      for (const book of books) {
        const cover = book.coverBlob
        if (!cover || made.get(book.id)?.blob === cover) continue
        try {
          made.set(book.id, { ...(await readCover(cover)), blob: cover })
        } catch (error) {
          console.warn('[bookworm] could not read the cover of', book.title, error)
        }
      }
    })
    return reading
  }

  function madeFor(bookId: string): MadeSpine | null {
    return made.get(bookId) ?? null
  }

  /** The painted spine on show for a book; null when it has none, or has set it aside. */
  function paintedFor(bookId: string): PaintedSpine | null {
    const kept = painted.get(bookId)
    return kept && !kept.record.setAside ? kept : null
  }

  /** Whether a painted spine is waiting, set aside, for this book. */
  function setAsideFor(bookId: string): boolean {
    return painted.get(bookId)?.record.setAside === true
  }

  /** Whether this book has ever been painted (and so must not be paid for again). */
  function owned(bookId: string): boolean {
    return painted.has(bookId)
  }

  /** Ask NanoGPT for a model's listed price, once a session. */
  function ensurePrice(modelId: string): void {
    if (listed.has(modelId)) return
    listed.set(modelId, null)
    void fetchListedPrice(modelId).then((price) => listed.set(modelId, price))
  }

  /** What one more spine will probably cost with a model (the chosen one by default). */
  function priceOfOne(modelId = useSettingsStore().spineModelId): number | null {
    const paid = useSpendStore().records.filter((record) => record.totalTokens === 0)
    return expectedCost(paid, modelId, listed.get(modelId) ?? null)
  }

  function describe(error: unknown): string {
    const code = useLanguageStore().code
    if (error instanceof NoImageError) return translateIn(code, 'spine.noImage')
    const status = error instanceof NanoGptError ? error.status : undefined
    return describeFailure(status, navigator.onLine !== false, failureWordsIn(code)).message
  }

  /**
   * Paint these books' spines, one after another. Stops at the first failure:
   * a refused key or an empty balance would refuse every one after it too.
   */
  async function paint(books: readonly BookMeta[]): Promise<void> {
    if (painting.value) return
    const settings = useSettingsStore()
    const spend = useSpendStore()
    const key = settings.apiKey.trim()
    const model = spineModel(settings.spineModelId)
    const todo = books.filter((book) => book.coverBlob)
    failure.value = null
    try {
      for (const [index, book] of todo.entries()) {
        painting.value = { bookId: book.id, done: index, total: todo.length }
        const reference = await coverDataUrl(book.coverBlob!)
        const result = await paintSpine(key, model, reference, book.title, book.author)
        await spend.recordImage(book.id, model.id, result.costUsd)
        const record: db.SpineRecord = {
          bookId: book.id,
          blob: await shrinkSpine(result.blob),
          modelId: model.id,
          at: Date.now(),
        }
        await db.saveSpine(record)
        await remember(record)
      }
    } catch (error) {
      failure.value = describe(error)
    } finally {
      painting.value = null
    }
  }

  /**
   * Back to the spine made from the cover — or forward to the painted one.
   * The painted spine is never deleted here: it was bought, so switching is
   * free in both directions and survives a reload.
   */
  async function choose(bookId: string, show: 'made' | 'painted'): Promise<void> {
    const kept = painted.get(bookId)
    if (!kept) return
    const record: db.SpineRecord = { ...kept.record, setAside: show === 'made' }
    await db.saveSpine(record)
    painted.set(bookId, { ...kept, record })
  }

  function dismissFailure(): void {
    failure.value = null
  }

  return {
    painting,
    failure,
    load,
    makeFor,
    madeFor,
    paintedFor,
    setAsideFor,
    owned,
    ensurePrice,
    priceOfOne,
    paint,
    choose,
    dismissFailure,
  }
})
