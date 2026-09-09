/**
 * What is left in the NanoGPT account.
 *
 * The shelf shows it beside what has been spent, and settings shows it under
 * the key — the same number, fetched once. It lives in a store rather than in
 * either component because two components asking the same question of the
 * network twice is how they end up disagreeing about the answer.
 *
 * Nothing is fetched without a key, and nothing is fetched twice inside
 * `FRESH_MS`: a balance is not a live ticker, and the shelf is a page a reader
 * comes back to constantly.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { checkBalance, NanoGptError } from '@/services/nanogpt'
import { describeFailure, type Failure } from '@/lib/failure'
import { failureWordsIn } from '@/i18n/bundles'
import { useLanguageStore } from '@/stores/language'
import { useSettingsStore } from '@/stores/settings'

/** How long a fetched balance is taken at its word. */
const FRESH_MS = 60_000

export const useBalanceStore = defineStore('balance', () => {
  const usd = ref<number | null>(null)
  const loading = ref(false)
  /** Classified like every other model-side failure, so a rejected key reads
   *  the same here as it does inside a book. */
  const failure = ref<Failure | null>(null)
  const fetchedAt = ref(0)

  const known = computed(() => usd.value !== null)

  /**
   * Fetch it, unless a fresh one is already in hand. `force` is what a reader
   * pressing the number means: ask again, now.
   */
  async function refresh(force = false): Promise<void> {
    const settings = useSettingsStore()
    const key = settings.apiKey.trim()
    if (key.length === 0) {
      usd.value = null
      failure.value = null
      return
    }
    if (loading.value) return
    if (!force && known.value && Date.now() - fetchedAt.value < FRESH_MS) return
    loading.value = true
    failure.value = null
    try {
      usd.value = (await checkBalance(key)).usdBalance
      fetchedAt.value = Date.now()
    } catch (error) {
      const language = useLanguageStore()
      const status = error instanceof NanoGptError ? error.status : null
      failure.value = describeFailure(
        status,
        navigator.onLine !== false,
        failureWordsIn(language.code),
      )
      // The last known figure is kept: a balance that vanishes because the
      // network blinked tells the reader less than a slightly old one does.
    } finally {
      loading.value = false
    }
  }

  /** The key changed — whatever is held belongs to the old account. */
  function forget(): void {
    usd.value = null
    failure.value = null
    fetchedAt.value = 0
  }

  return { usd, loading, failure, known, refresh, forget }
})
