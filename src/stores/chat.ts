/** Per-book chat state and the send/stream orchestration. */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { describeFailure, setupFailure, type Failure } from '@/lib/failure'
import { failureWordsIn } from '@/i18n/bundles'
import { buildMessages, type BookInfo, type ChatMessage, type Reference } from '@/lib/prompt'
import { getChatConversation, saveChatConversation } from '@/services/db'
import { NanoGptError, streamChat, type ChatUsage } from '@/services/nanogpt'
import { useSettingsStore } from '@/stores/settings'
import { useLanguageStore } from '@/stores/language'
import { DEFAULT_LANGUAGE, languageName } from '@/lib/language'
import { useSpendStore } from '@/stores/spend'

export interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  /** Labels of reference blocks that accompanied a user message. */
  referenceLabels?: string[]
  usage?: ChatUsage | null
}

export const useChatStore = defineStore('chat', () => {
  /** Conversations keyed by book id, mirrored to IndexedDB. */
  const conversations = ref<Record<string, DisplayMessage[]>>({})
  const loadedBooks = new Set<string>()
  const sending = ref(false)
  /**
   * Why the last attempt did not work, classified — not a string. A rejected
   * key and a dropped connection are different problems with different fixes,
   * and the panel can only offer the right one if it is told which happened.
   */
  const failure = ref<Failure | null>(null)
  /** The last question, kept so it can simply be asked again. */
  let lastAttempt: Parameters<typeof send> | null = null
  /**
   * The in-flight request, so it can be stopped. Every token of an answer the
   * reader has already judged wrong is money spent, and the panel used to
   * offer no way out but waiting.
   */
  let inFlight: AbortController | null = null

  /** Abort the current reply, KEEPING whatever has already arrived. */
  function stop(): void {
    inFlight?.abort()
    inFlight = null
  }

  /** Load a book's persisted conversation once per session. */
  async function ensureLoaded(bookId: string): Promise<void> {
    if (loadedBooks.has(bookId)) return
    loadedBooks.add(bookId)
    const stored = await getChatConversation(bookId).catch(() => undefined)
    if (stored && !(bookId in conversations.value)) {
      conversations.value = { ...conversations.value, [bookId]: stored.messages }
    }
  }

  async function persist(bookId: string): Promise<void> {
    const messages = (conversations.value[bookId] ?? []).map((message) => ({
      role: message.role,
      content: message.content,
      // Copy the array: Vue reactive proxies cannot be structured-cloned into
      // IndexedDB (DataCloneError), and nested arrays stay proxied.
      ...(message.referenceLabels ? { referenceLabels: [...message.referenceLabels] } : {}),
    }))
    await saveChatConversation({ bookId, messages, updatedAt: Date.now() }).catch(() => {})
  }

  function messagesFor(bookId: string): DisplayMessage[] {
    return conversations.value[bookId] ?? []
  }

  function historyFor(bookId: string): ChatMessage[] {
    return messagesFor(bookId).map((message) => ({
      role: message.role,
      content: message.content,
    }))
  }

  async function send(
    bookId: string,
    book: BookInfo,
    question: string,
    references: Reference[],
    spoilersAllowed: boolean,
    modelOverride: string | null = null,
  ): Promise<void> {
    const settings = useSettingsStore()
    const modelId = (modelOverride ?? settings.modelId).trim()
    const words = failureWordsIn(useLanguageStore().code)
    const unset = setupFailure(settings.apiKey.trim().length > 0, modelId.length > 0, words)
    if (unset) {
      failure.value = unset
      return
    }
    if (sending.value) return

    lastAttempt = [bookId, book, question, references, spoilersAllowed, modelOverride]
    sending.value = true
    failure.value = null
    const controller = new AbortController()
    inFlight = controller

    const history = historyFor(bookId)
    // The assistant speaks to the reader in the reader's language; English is
    // passed as null because saying it adds nothing (see buildSystemPrompt).
    const language = useLanguageStore()
    const answerIn = language.code === DEFAULT_LANGUAGE ? null : languageName(language.code)
    const outgoing = buildMessages(book, spoilersAllowed, history, question, references, answerIn)

    const conversation = [...messagesFor(bookId)]
    conversation.push({
      role: 'user',
      content: question,
      referenceLabels: references.map((reference) => reference.label),
    })
    const assistantMessage: DisplayMessage = { role: 'assistant', content: '' }
    conversation.push(assistantMessage)
    conversations.value = { ...conversations.value, [bookId]: conversation }

    try {
      const { usage } = await streamChat({
        apiKey: settings.apiKey,
        model: modelId,
        messages: outgoing,
        onDelta: (text) => {
          assistantMessage.content += text
        },
        signal: controller.signal,
      })
      assistantMessage.usage = usage
      if (usage) {
        const spend = useSpendStore()
        // Pricing comes from the models list, which the user may never have
        // loaded in this session (e.g. book opened directly after a reload).
        if (settings.models.length === 0) await settings.loadModels().catch(() => {})
        const model = settings.modelById(modelId)
        const pricing =
          model && model.promptPrice !== null && model.completionPrice !== null
            ? { promptPrice: model.promptPrice, completionPrice: model.completionPrice }
            : null
        await spend.record(bookId, modelId, usage, pricing)
      }
    } catch (cause) {
      const stopped = controller.signal.aborted
      // A stopped reply is not a failure: the reader asked for it and the words
      // that arrived are theirs to keep. Only drop the stub if it is empty.
      if (!stopped || assistantMessage.content.length === 0) {
        // A question that was never answered comes back out of the transcript
        // too — left in, it reads as a question the book ignored, and asking
        // again would then put it there twice.
        const dropped = stopped
          ? [assistantMessage]
          : [assistantMessage, conversation[conversation.length - 2]]
        conversations.value = {
          ...conversations.value,
          [bookId]: conversation.filter((message) => !dropped.includes(message)),
        }
      }
      if (!stopped) {
        const status = cause instanceof NanoGptError ? cause.status : null
        failure.value = describeFailure(status, navigator.onLine !== false, words)
      }
    } finally {
      if (inFlight === controller) inFlight = null
      sending.value = false
      await persist(bookId)
    }
  }

  /** Ask the same question again — the whole of what "Try again" means. */
  async function retry(): Promise<void> {
    if (!lastAttempt || sending.value) return
    failure.value = null
    await send(...lastAttempt)
  }

  async function clearConversation(bookId: string): Promise<void> {
    const { [bookId]: _removed, ...rest } = conversations.value
    conversations.value = rest
    await persist(bookId)
  }

  return {
    conversations,
    sending,
    failure,
    messagesFor,
    ensureLoaded,
    send,
    retry,
    stop,
    clearConversation,
  }
})
