/**
 * Which language the reader wants Bookworm in, and whether they have ever been
 * asked.
 *
 * A preference, not user data, so localStorage is its home (see DECISIONS).
 * Two facts are kept rather than one: the CODE, and whether the reader has
 * actually chosen it. A guess from the browser is not a choice, and the
 * difference is what stops the chooser from asking a second time.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { guessLanguage, isLanguageCode } from '@/lib/language'
import {
  LANGUAGE_KEY as LANG_KEY,
  LANGUAGE_HINT_KEY as HINT_KEY,
  readPref as read,
  writePref as write,
} from '@/services/firstRun'

export const useLanguageStore = defineStore('language', () => {
  const stored = read(LANG_KEY)
  /** True when this reader has answered for themselves. */
  const chosen = ref(isLanguageCode(stored))
  /**
   * Until the reader answers, the browser's own preference stands in: it is
   * the best evidence there is about who is holding the phone, and it costs
   * them nothing to overrule — the chooser simply opens on that row.
   */
  const code = ref<string>(
    isLanguageCode(stored)
      ? stored
      : guessLanguage(typeof navigator === 'undefined' ? [] : navigator.languages),
  )

  /** Whether the little "it lives here" note by the nav icon is still owed. */
  const hintOwed = ref(read(HINT_KEY) === null)
  const hintVisible = ref(false)

  /** The language the app actually renders in — English until the others are
   *  written. Kept separate from the CHOICE so the choice can be recorded
   *  honestly in the meantime. */
  function choose(next: string): void {
    if (!isLanguageCode(next)) return
    code.value = next
    chosen.value = true
    write(LANG_KEY, next)
  }

  /** Offer the note by the nav icon — once ever, and only when asked for. */
  function offerHint(): void {
    if (!hintOwed.value) return
    hintVisible.value = true
  }

  function dismissHint(): void {
    hintVisible.value = false
    hintOwed.value = false
    write(HINT_KEY, 'seen')
  }

  return { code, chosen, hintOwed, hintVisible, choose, offerHint, dismissHint }
})
