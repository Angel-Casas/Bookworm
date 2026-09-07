/** Tracks money spent on the LLM, aggregated from persisted spend records. */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { generateId } from '@/lib/id'
import { computeCostUsd, type ModelPricing } from '@/lib/cost'
import { addSpendRecord, listSpendRecords, type SpendRecord } from '@/services/db'
import type { ChatUsage } from '@/services/nanogpt'

export const useSpendStore = defineStore('spend', () => {
  const records = ref<SpendRecord[]>([])
  const loaded = ref(false)

  const totalUsd = computed(() =>
    records.value.reduce((sum, record) => sum + (record.costUsd ?? 0), 0),
  )

  /** True when some requests had unknown pricing, so totals are lower bounds. */
  const hasUnpriced = computed(() => records.value.some((record) => record.costUsd === null))

  function totalForBook(bookId: string): number {
    return records.value
      .filter((record) => record.bookId === bookId)
      .reduce((sum, record) => sum + (record.costUsd ?? 0), 0)
  }

  async function load(): Promise<void> {
    if (loaded.value) return
    records.value = await listSpendRecords()
    loaded.value = true
  }

  async function record(
    bookId: string,
    modelId: string,
    usage: ChatUsage,
    pricing: ModelPricing | null,
  ): Promise<void> {
    const entry: SpendRecord = {
      id: generateId(),
      bookId,
      modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      costUsd: computeCostUsd(
        { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
        pricing,
      ),
      at: Date.now(),
    }
    await addSpendRecord(entry)
    records.value = [...records.value, entry]
  }

  return { records, loaded, totalUsd, hasUnpriced, totalForBook, load, record }
})
