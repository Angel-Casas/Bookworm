/**
 * Whether a newer Bookworm is waiting, and the means to take it.
 *
 * The store holds one flag and one action, so the notice that shows it can stay
 * a piece of markup with no idea what a service worker is.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { watchForUpdate, type ApplyUpdate } from '@/services/pwa'

export const useUpdateStore = defineStore('update', () => {
  /** A new version is installed and waiting for permission to take over. */
  const waiting = ref(false)
  /** Set while the page is being handed over, so the button cannot be pressed
   *  twice into two reloads. */
  const applying = ref(false)
  /** True once the reader has waved it away for this visit. It is not written
   *  to storage: the update is still waiting, and the next launch should say
   *  so again rather than quietly running old code forever. */
  const dismissed = ref(false)

  let apply: ApplyUpdate = null

  async function watch(): Promise<void> {
    apply = await watchForUpdate({
      onWaiting: () => {
        waiting.value = true
      },
    })
  }

  async function take(): Promise<void> {
    if (apply === null || applying.value) return
    applying.value = true
    try {
      await apply()
    } catch {
      // The reload did not happen; leave the notice up rather than pretending.
      applying.value = false
    }
  }

  function dismiss(): void {
    dismissed.value = true
  }

  return { waiting, applying, dismissed, watch, take, dismiss }
})
