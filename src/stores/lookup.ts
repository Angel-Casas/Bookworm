/**
 * One word, one small answer.
 *
 * This is the assistant, but not the conversation: a gloss carries no history,
 * lands in no transcript, and is gone when the reader closes it. What it does
 * share with the chat is the money — a lookup is a model call like any other,
 * so it is recorded in the same ledger and shows up in the book's spend.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { describeFailure, setupFailure, type Failure } from '@/lib/failure'
import { failureWordsIn } from '@/i18n/bundles'
import { buildLookupMessages, sentenceAround } from '@/lib/lookup'
import { DEFAULT_LANGUAGE, languageName } from '@/lib/language'
import type { BookInfo } from '@/lib/prompt'
import { NanoGptError, streamChat } from '@/services/nanogpt'
import { useLanguageStore } from '@/stores/language'
import { useSettingsStore } from '@/stores/settings'
import { useSpendStore } from '@/stores/spend'

export const useLookupStore = defineStore('lookup', () => {
  /** The word being glossed; null when the card is closed. */
  const term = ref<string | null>(null)
  /** The sentence it was taken from, shown so the reader can see the context
   *  the answer was given. */
  const sentence = ref('')
  const answer = ref('')
  const pending = ref(false)
  /** Why the gloss did not arrive, classified — same vocabulary the chat
   *  uses, so a rejected key reads the same in both places. */
  const failure = ref<Failure | null>(null)
  /** The last lookup, so it can simply be asked again. */
  let lastAttempt: Parameters<typeof look> | null = null

  /**
   * Glosses already paid for this session, keyed by book, word and sentence.
   * Tapping the same word twice on the same page is a common thing to do —
   * charging for it twice is not.
   */
  const cache = new Map<string, string>()
  let inFlight: AbortController | null = null

  function close(): void {
    inFlight?.abort()
    inFlight = null
    term.value = null
    sentence.value = ''
    answer.value = ''
    failure.value = null
    pending.value = false
  }

  /**
   * Look `word` up, using `context` — the block of text it was selected in —
   * to find the sentence it belongs to.
   */
  async function look(
    bookId: string,
    book: BookInfo,
    word: string,
    context: string,
    modelOverride: string | null = null,
  ): Promise<void> {
    const settings = useSettingsStore()
    const modelId = (modelOverride ?? settings.modelId).trim()

    inFlight?.abort()
    term.value = word
    sentence.value = sentenceAround(context, word)
    answer.value = ''
    failure.value = null
    lastAttempt = [bookId, book, word, context, modelOverride]

    const words = failureWordsIn(useLanguageStore().code)
    const unset = setupFailure(settings.apiKey.trim().length > 0, modelId.length > 0, words)
    if (unset) {
      failure.value = unset
      return
    }

    const key = `${bookId}::${word.toLowerCase()}::${sentence.value}`
    const remembered = cache.get(key)
    if (remembered !== undefined) {
      answer.value = remembered
      return
    }

    // A gloss is about the word HERE, on a page the reader has reached — there
    // is nothing to be gained by letting it range over the rest of the book,
    // and a spoiler in a margin note is the worst place for one.
    const language = useLanguageStore()
    const answerIn = language.code === DEFAULT_LANGUAGE ? null : languageName(language.code)
    const messages = buildLookupMessages(book, word, sentence.value, false, answerIn)

    pending.value = true
    const controller = new AbortController()
    inFlight = controller
    try {
      const { usage } = await streamChat({
        apiKey: settings.apiKey,
        model: modelId,
        messages,
        onDelta: (text) => {
          // A gloss that arrived after the card was closed belongs to nobody.
          if (!controller.signal.aborted) answer.value += text
        },
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (answer.value.trim().length > 0) cache.set(key, answer.value)
      if (usage) {
        const spend = useSpendStore()
        if (settings.models.length === 0) await settings.loadModels().catch(() => {})
        const model = settings.modelById(modelId)
        const pricing =
          model && model.promptPrice !== null && model.completionPrice !== null
            ? { promptPrice: model.promptPrice, completionPrice: model.completionPrice }
            : null
        await spend.record(bookId, modelId, usage, pricing)
      }
    } catch (cause) {
      if (controller.signal.aborted) return
      const status = cause instanceof NanoGptError ? cause.status : null
      failure.value = describeFailure(status, navigator.onLine !== false, words)
    } finally {
      if (inFlight === controller) inFlight = null
      pending.value = false
    }
  }

  /** Ask for the same gloss again. */
  async function retry(): Promise<void> {
    if (!lastAttempt || pending.value) return
    await look(...lastAttempt)
  }

  return { term, sentence, answer, pending, failure, look, retry, close }
})
