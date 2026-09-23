/**
 * Whether Bookworm can be put on the device, and whether we have said so.
 *
 * The offer is made ONCE — a plate under the nav, on the visit where the
 * browser says the app is installable — and then never again. After that it
 * lives where a reader would go looking for it: the browser's own address bar,
 * and a line in settings that does the same thing.
 *
 * Whether it has been said is a preference, not user data, so localStorage is
 * its home (see DECISIONS) — and the same shape as the language note, which
 * asks its one question in the same way.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { isIosBrowser, isStandalone, watchInstall, type OfferInstall } from '@/services/install'
import {
  INSTALL_HINT_KEY as HINT_KEY,
  readPref as read,
  writePref as write,
} from '@/services/firstRun'

export const useInstallStore = defineStore('install', () => {
  /** The browser has handed over an install offer we can still use. */
  const available = ref(false)
  /**
   * Already an app on this device — so there is nothing to offer.
   *
   * Known from the first moment, not from `start()`: the note's watcher runs
   * while the app is still being set up, and asking "is this installed?" only
   * later is how the installed app came to offer to install itself.
   */
  const installed = ref(isStandalone())
  /** Whether the one-time note is still owed. */
  const hintOwed = ref(read(HINT_KEY) === null)
  const hintVisible = ref(false)
  /** True while the browser's own dialogue is up, so the button cannot be
   *  pressed into two of them. */
  const asking = ref(false)

  let offer: OfferInstall | null = null

  /** Can be asked for from settings — the plate is not the only door. */
  const offerable = computed(() => available.value && !installed.value)
  /**
   * True where the app can be installed but only by hand: an iPhone or iPad,
   * where there is no dialogue to open and the reader has to be told which
   * menu it is in.
   */
  const byHand = computed(() => !available.value && !installed.value && isIosBrowser())

  function start(): void {
    if (isStandalone()) installed.value = true
    offer = watchInstall({
      onAvailable: () => {
        available.value = true
      },
      onInstalled: () => {
        installed.value = true
        available.value = false
        hintVisible.value = false
        retire()
      },
    })
  }

  /**
   * Show the note, if it is still owed and there is anything to say. Whoever
   * calls this decides WHEN — the app has other things to say to a first-time
   * reader, and they should not all arrive at once.
   */
  function offerHint(): void {
    if (!hintOwed.value || installed.value) return
    if (!available.value && !byHand.value) return
    hintVisible.value = true
    // Said once means said once: it is spent the moment it is on screen, not
    // when the reader gets round to answering it.
    retire()
  }

  async function install(): Promise<void> {
    if (offer === null || asking.value) return
    asking.value = true
    try {
      const outcome = await offer()
      if (outcome === 'accepted') installed.value = true
      // Taken or refused, the browser's offer is spent. It may hand over
      // another one on a later visit; there is not a second one today.
      available.value = false
    } finally {
      asking.value = false
      hintVisible.value = false
    }
  }

  function dismissHint(): void {
    hintVisible.value = false
    retire()
  }

  function retire(): void {
    hintOwed.value = false
    write(HINT_KEY, 'seen')
  }

  return {
    available,
    installed,
    offerable,
    byHand,
    hintOwed,
    hintVisible,
    asking,
    start,
    offerHint,
    install,
    dismissHint,
  }
})
