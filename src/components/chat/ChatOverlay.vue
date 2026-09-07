<script setup lang="ts">
/**
 * The assistant that lives inside the book.
 *
 * It is a DRAWER across the reader by default, not a card in the corner: the
 * book stays visible above it, which is the whole reason to have an assistant
 * in the book rather than a tab beside it. Detaching moves it to a right-hand
 * column, trading the book's width for its full height — the better trade on a
 * wide screen. Either way the reader drags the shared edge to say how much
 * room the conversation gets, and that choice is remembered per dock.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { DEFAULT_CONTEXT_TOKENS, RESERVED_COMPLETION_TOKENS } from '@/config'
import { estimateScope, formatEstimate } from '@/lib/scopeEstimate'
import { setupFailure } from '@/lib/failure'
import { useI18n, type MessageKey } from '@/i18n'
import { failureWordsIn } from '@/i18n/bundles'
import { useLanguageStore } from '@/stores/language'
import { OPENINGS, type Opening, type Reference } from '@/lib/prompt'
import type { QuizSetup } from '@/lib/quiz'
import type { CitationSource } from '@/lib/citation'
import type { BookMeta } from '@/lib/types'
import { getBookSections } from '@/services/bookText'
import { useAnnotationsStore } from '@/stores/annotations'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { CHAT_SIZE_MAX, CHAT_SIZE_MIN } from '@/stores/ui'
import AssistantTrouble from '@/components/chat/AssistantTrouble.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import ModelPicker from '@/components/ModelPicker.vue'
import QuizSheet from '@/components/chat/QuizSheet.vue'
import IconClose from '@/components/icons/IconClose.vue'
import IconDetach from '@/components/icons/IconDetach.vue'

/** How much of the book travels with the question. */
type ContextChoice = 'none' | 'selection' | 'section' | 'book-so-far' | 'whole-book'

const props = defineProps<{
  book: BookMeta
  blob: Blob
  currentSectionIndex: number
  selection: string | null
  /** Label for where the reader is, e.g. "Page 12" — shown in the header. */
  placeLabel?: string
}>()

const emit = defineEmits<{
  modelChange: [modelId: string | null]
  jump: [position: string]
  clearSelection: []
  /** The panel changed size on its own (the quiz sheet asks for room). */
  resized: []
}>()

const chat = useChatStore()
const settings = useSettingsStore()
const language = useLanguageStore()
const { t } = useI18n()
const ui = useUiStore()
const annotations = useAnnotationsStore()

const open = computed({
  get: () => ui.chatOpen,
  set: (value: boolean) => ui.setChatOpen(value),
})
const question = ref('')
const contextChoice = ref<ContextChoice>('section')
const contextWarning = ref<string | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const scrollRef = ref<HTMLDivElement | null>(null)
const keptAnswers = ref<Set<string>>(new Set())
/** Positions of the reference blocks sent with each user turn, by turn index. */
const sentSources = ref<Record<number, CitationSource[]>>({})

const messages = computed(() => chat.messagesFor(props.book.id))
const configured = computed(
  () => settings.apiKey.trim().length > 0 && settings.modelId.trim().length > 0,
)
const sectionNoun = computed(() =>
  props.book.format === 'pdf' ? t('chat.scopeSectionPage') : t('chat.scopeSectionChapter'),
)
/** What is missing before a question can be asked at all. */
const setupNeeded = computed(() =>
  setupFailure(
    settings.apiKey.trim().length > 0,
    settings.modelId.trim().length > 0,
    failureWordsIn(language.code),
  ),
)

void chat.ensureLoaded(props.book.id)
void settings.loadModels()

/**
 * How much room the pager row must leave for this plate.
 *
 * The plate sits at the end of that row but is drawn from here, so the row
 * cannot measure it — and a width hard-coded from the English "Ask the book"
 * puts the Spanish "Pregunta al libro" on top of "Siguiente". The button
 * measures itself and publishes the room it needs (its width plus the gap on
 * either side) to the box that holds them both, where the row's own CSS reads
 * it. Zero when the panel is open: there is no plate to make room for.
 */
const toggleRef = ref<HTMLButtonElement | null>(null)
const PLATE_GAP_REM = 1.8
let plateWatcher: ResizeObserver | null = null

function publishPlateRoom(width: number | null): void {
  const host = rootRef.value?.parentElement
  if (!host) return
  host.style.setProperty(
    '--chat-plate-room',
    width === null ? '0px' : `calc(${Math.ceil(width)}px + ${PLATE_GAP_REM}rem)`,
  )
}

watch(toggleRef, (element) => {
  plateWatcher?.disconnect()
  plateWatcher = null
  if (!element) {
    publishPlateRoom(null)
    return
  }
  // offsetWidth, not the entry's contentRect: the plate has 0.9em of padding
  // on each side and a border, and a reservation made from the CONTENT box is
  // short by exactly those — which is a plate resting against "Siguiente"
  // rather than beside it.
  plateWatcher = new ResizeObserver(() => publishPlateRoom(element.offsetWidth))
  plateWatcher.observe(element)
  publishPlateRoom(element.offsetWidth)
})

/**
 * What the reader is typing ON. The placeholder carries the Enter/Shift+Enter
 * hint, which is three wasted lines of a phone's composer and advice nobody
 * with a touch keyboard can take.
 */
const typedOn = ref<'keyboard' | 'touch'>('keyboard')
const coarse = window.matchMedia?.('(hover: none)')
function readPointer(): void {
  typedOn.value = coarse?.matches ? 'touch' : 'keyboard'
}
readPointer()
coarse?.addEventListener('change', readPointer)

function openPanel(): void {
  open.value = true
  void nextTick(() => composerRef.value?.focus())
}

defineExpose({ openPanel })

/* ————————————————————————— models ————————————————————————— */

const bookModelChoice = computed({
  get: () => props.book.modelId ?? '',
  set: (value: string) => emit('modelChange', value.length > 0 ? value : null),
})

const effectiveModel = computed(() => settings.modelById(props.book.modelId ?? settings.modelId))

function contextBudget(): number {
  const contextLength = effectiveModel.value?.contextLength ?? DEFAULT_CONTEXT_TOKENS
  return Math.max(1000, contextLength - RESERVED_COMPLETION_TOKENS)
}

/* ————————————————————— context and its price ————————————————————— */

/**
 * Choosing a scope past where you have read IS the spoiler decision — there is
 * no second checkbox to forget. Everything up to "book so far" stays
 * spoiler-safe; the whole book cannot be.
 */
const spoilersAllowed = computed(() => contextChoice.value === 'whole-book')

/** Section texts are needed both to send AND to price, so they are cached. */
const sectionCache = ref<{ label: string; text: string; index: number; position: string }[] | null>(
  null,
)

async function ensureSections(): Promise<
  { label: string; text: string; index: number; position: string }[]
> {
  if (sectionCache.value) return sectionCache.value
  const sections = await getBookSections(props.book.id, props.book.format, props.blob)
  sectionCache.value = sections.map((section) => ({
    label: section.label,
    text: section.text,
    index: section.index,
    position: section.position,
  }))
  return sectionCache.value
}

function chosenSections(): { label: string; text: string; position: string }[] {
  const sections = sectionCache.value ?? []
  if (contextChoice.value === 'section') {
    return sections.filter((section) => section.index === props.currentSectionIndex)
  }
  if (contextChoice.value === 'book-so-far') {
    return sections.filter((section) => section.index <= props.currentSectionIndex)
  }
  if (contextChoice.value === 'whole-book') return sections
  return []
}

// Pricing the scope needs the book's text, so fetch it whenever the choice
// changes — the estimate is the whole point of the control.
watch(
  [() => contextChoice.value, () => open.value],
  () => {
    if (!open.value) return
    if (contextChoice.value === 'none' || contextChoice.value === 'selection') return
    void ensureSections()
  },
  { immediate: true },
)

const estimate = computed(() => {
  const texts: string[] = []
  if (props.selection) texts.push(props.selection)
  for (const section of chosenSections()) texts.push(section.text)
  const model = effectiveModel.value
  return estimateScope({
    referenceTexts: texts,
    conversationChars:
      question.value.length +
      messages.value.reduce((total, message) => total + message.content.length, 0),
    budgetTokens: contextBudget(),
    reservedCompletionTokens: RESERVED_COMPLETION_TOKENS,
    pricing:
      model && model.promptPrice !== null && model.completionPrice !== null
        ? { promptPrice: model.promptPrice, completionPrice: model.completionPrice }
        : null,
  })
})

const estimateLabel = computed(() =>
  formatEstimate(estimate.value, language.code, t('chat.tokens')),
)

/* ————————————————————————— sending ————————————————————————— */

async function collectReferences(): Promise<Reference[]> {
  contextWarning.value = null
  const references: Reference[] = []
  if (props.selection) {
    references.push({ kind: 'selection', label: t('chat.selectionLabel'), text: props.selection })
  }
  if (contextChoice.value === 'none' || contextChoice.value === 'selection') return references

  await ensureSections()
  const chosen = chosenSections()
  const kind: Reference['kind'] =
    contextChoice.value === 'section'
      ? 'section'
      : contextChoice.value === 'book-so-far'
        ? 'book-so-far'
        : 'whole-book'

  // The budget is applied here as before, but the reader was already warned by
  // the estimate — this is the belt to that pair of braces.
  const { fitBlocksToBudget } = await import('@/lib/tokens')
  const fitted = fitBlocksToBudget(
    chosen.map((section) => ({ label: section.label, text: section.text })),
    contextBudget(),
  )
  if (fitted.truncated) {
    contextWarning.value = t('chat.trimmed')
  }
  const positions = new Map(chosen.map((section) => [section.label, section.position]))
  for (const block of fitted.blocks) {
    references.push({
      kind,
      label: block.label,
      text: block.text,
      position: positions.get(block.label),
    })
  }
  return references
}

async function submit(): Promise<void> {
  const text = question.value.trim()
  if (text.length === 0 || chat.sending) return
  const references = await collectReferences().catch(() => {
    contextWarning.value = t('chat.noText')
    return [] as Reference[]
  })
  question.value = ''
  // Remember where this turn's references point, so the answer's citations can
  // be pressed. Keyed by the index the user turn will land on.
  sentSources.value = {
    ...sentSources.value,
    [messages.value.length]: references
      .filter((reference): reference is Reference & { position: string } =>
        Boolean(reference.position),
      )
      .map((reference) => ({ label: reference.label, position: reference.position })),
  }
  await chat.send(
    props.book.id,
    { title: props.book.title, author: props.book.author },
    text,
    references,
    spoilersAllowed.value,
    props.book.modelId ?? null,
  )
}

/** Enter sends; Shift+Enter breaks the line — this panel is for long questions. */
function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
}

async function useOpening(opening: Opening): Promise<void> {
  if (chat.sending) return
  // The quiz is the one opening worth setting up first — see QuizSheet.vue.
  if (opening.id === 'quiz') {
    openQuiz()
    return
  }
  if (opening.scope !== 'keep') contextChoice.value = opening.scope
  question.value = opening.question
  await submit()
}

/* ————————————————————————— the quiz ————————————————————————— */

const quizOpen = ref(false)
const quizDraft = ref<QuizSetup>({ ...ui.quizSetup })

/** The draft's scope IS the message's scope, so the estimate prices the quiz. */
function applyQuizScope(): void {
  contextChoice.value = quizDraft.value.scope
}

// Opening the sheet grows the drawer, and the drawer's size comes out of the
// book's pane — so the reader is told in the same tick, as with focus mode.
watch(quizOpen, () => emit('resized'))

function openQuiz(): void {
  quizDraft.value = { ...ui.quizSetup }
  applyQuizScope()
  quizOpen.value = true
}

/** The controls are a preference, so they are kept as they are moved — losing
 *  them to a stray Escape would mean setting the same quiz up twice. The
 *  hand-edited PROMPT is not kept: that one is about this quiz. */
function onQuizUpdate(next: QuizSetup): void {
  quizDraft.value = next
  ui.setQuizSetup(next)
  applyQuizScope()
}

async function startQuiz(prompt: string): Promise<void> {
  quizOpen.value = false
  applyQuizScope()
  question.value = prompt
  await submit()
}

const availableOpenings = computed(() =>
  OPENINGS.filter((opening) => !opening.needsSelection || props.selection !== null),
)

/* ————————————————————— keeping and clearing ————————————————————— */

async function keepAnswer(index: number): Promise<void> {
  const message = messages.value[index]
  if (!message || message.content.length === 0) return
  const label =
    props.placeLabel && props.placeLabel.length > 0 ? props.placeLabel : t('chat.keptAnswer')
  const position = props.book.position ?? String(Math.max(1, props.currentSectionIndex + 1))
  await annotations.add(props.book.id, 'note', position, label, message.content)
  keptAnswers.value = new Set(keptAnswers.value).add(String(index))
}

function copyAnswer(index: number): void {
  const content = messages.value[index]?.content ?? ''
  void navigator.clipboard?.writeText(content).catch(() => {})
}

async function clearAll(): Promise<void> {
  await chat.clearConversation(props.book.id)
  sentSources.value = {}
  keptAnswers.value = new Set()
}

/** The sources an answer at `index` may cite: those sent with the turn before. */
function sourcesFor(index: number): CitationSource[] {
  return sentSources.value[index - 1] ?? []
}

/* ————————————————————— the shared edge ————————————————————— */

const rootRef = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const size = computed(() => ui.chatSize[ui.chatDock])

function onGripDown(event: PointerEvent): void {
  const stage = rootRef.value?.parentElement
  if (!stage) return
  dragging.value = true
  ;(event.target as Element).setPointerCapture?.(event.pointerId)
  const box = stage.getBoundingClientRect()

  const move = (moveEvent: PointerEvent): void => {
    const percent =
      ui.chatDock === 'drawer'
        ? ((box.bottom - moveEvent.clientY) / box.height) * 100
        : ((box.right - moveEvent.clientX) / box.width) * 100
    ui.setChatSize(percent)
  }
  const up = (): void => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    // A finger's drag can be TAKEN from us — the browser decides mid-gesture
    // that it was a scroll after all and sends pointercancel instead of
    // pointerup. Without this the panel stayed stuck in "dragging" for good.
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/** The grip is a real control: arrows resize it without a mouse. */
function onGripKey(event: KeyboardEvent): void {
  const grow = ui.chatDock === 'drawer' ? 'ArrowUp' : 'ArrowLeft'
  const shrink = ui.chatDock === 'drawer' ? 'ArrowDown' : 'ArrowRight'
  if (event.key !== grow && event.key !== shrink) return
  event.preventDefault()
  ui.setChatSize(size.value + (event.key === grow ? 4 : -4))
}

// New words should not scroll away from someone reading further up, so only
// follow the stream when they are already at the bottom.
let pinned = true
function onScroll(): void {
  const el = scrollRef.value
  if (!el) return
  pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
watch(
  () => messages.value.map((message) => message.content.length).join(),
  async () => {
    if (!pinned) return
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

onBeforeUnmount(() => {
  if (chat.sending) chat.stop()
  plateWatcher?.disconnect()
  coarse?.removeEventListener('change', readPointer)
})
</script>

<template>
  <div
    ref="rootRef"
    class="chat-root"
    :class="[
      open ? `dock-${ui.chatDock}` : 'closed',
      {
        dragging,
        'quiz-open': quizOpen,
        'under-overlay': ui.overlay !== null,
        'needs-setup': setupNeeded !== null,
      },
    ]"
    :style="open ? { '--chat-size': `${size}%` } : undefined"
    :data-dock="open ? ui.chatDock : 'closed'"
  >
    <button
      v-if="!open"
      ref="toggleRef"
      type="button"
      class="chat-toggle"
      data-testid="chat-toggle"
      @click="openPanel"
    >
      {{ t('chat.open') }}
    </button>

    <template v-else>
      <!-- The edge between book and conversation, dragged to divide them. -->
      <div
        class="grip"
        role="separator"
        tabindex="0"
        :aria-orientation="ui.chatDock === 'drawer' ? 'horizontal' : 'vertical'"
        :aria-label="t('chat.resize')"
        :aria-valuenow="Math.round(size)"
        :aria-valuemin="CHAT_SIZE_MIN"
        :aria-valuemax="CHAT_SIZE_MAX"
        data-testid="chat-grip"
        @pointerdown="onGripDown"
        @keydown="onGripKey"
      >
        <i aria-hidden="true"></i>
      </div>

      <aside class="chat-panel" data-testid="chat-panel" aria-label="Book assistant">
        <!-- Setting up a quiz takes the whole panel: for those few seconds it
             IS the panel's job, and a form squeezed under the conversation
             would be a worse version of both. It rises over the conversation
             rather than replacing it in one frame, so it reads as something
             laid on top and taken away again. -->
        <Transition name="panel-rise">
          <QuizSheet
            v-if="quizOpen"
            :setup="quizDraft"
            :estimate-label="estimateLabel"
            :estimate-over="estimate.overBudget"
            :busy="chat.sending"
            @update:setup="onQuizUpdate"
            @close="quizOpen = false"
            @start="startQuiz"
          />
        </Transition>

        <header class="chat-header">
          <strong>Bookworm</strong>
          <span v-if="placeLabel" class="place" data-testid="chat-place">{{ placeLabel }}</span>
          <span class="spoiler-state" :data-safe="!spoilersAllowed">
            {{ spoilersAllowed ? t('chat.spoilersOn') : t('chat.spoilerSafe') }}
          </span>
          <div class="header-actions">
            <button
              v-if="messages.length > 0"
              type="button"
              class="ghost"
              data-testid="chat-clear"
              :title="t('chat.clearTitle')"
              @click="clearAll"
            >
              {{ t('chat.clear') }}
            </button>
            <button
              type="button"
              class="icon-btn"
              data-testid="chat-dock-toggle"
              :aria-pressed="ui.chatDock === 'side'"
              :title="ui.chatDock === 'drawer' ? t('chat.toSide') : t('chat.toBottom')"
              :aria-label="ui.chatDock === 'drawer' ? t('chat.toSide') : t('chat.toBottom')"
              @click="ui.toggleChatDock()"
            >
              <IconDetach :dock="ui.chatDock" class="ctl-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-btn"
              data-testid="chat-close"
              :aria-label="t('chat.close')"
              :title="t('overlay.close')"
              @click="open = false"
            >
              <IconClose class="ctl-icon" aria-hidden="true" />
            </button>
          </div>
        </header>

        <!-- Not set up yet is a failure like any other: it says what is
             missing and offers the one place that fixes it, over the book
             rather than instead of it. -->
        <AssistantTrouble v-if="setupNeeded" :failure="setupNeeded" class="trouble-block" />

        <div ref="scrollRef" class="messages" data-testid="chat-messages" @scroll="onScroll">
          <div v-if="messages.length === 0" class="opener">
            <p class="opener-lede">{{ t('chat.lede') }}</p>
          </div>
          <ChatMessage
            v-for="(message, index) in messages"
            :key="index"
            :role="message.role"
            :content="message.content"
            :reference-labels="message.referenceLabels"
            :sources="sourcesFor(index)"
            :streaming="
              chat.sending && index === messages.length - 1 && message.role === 'assistant'
            "
            :kept="keptAnswers.has(String(index))"
            @jump="emit('jump', $event)"
            @keep="keepAnswer(index)"
            @copy="copyAnswer(index)"
          />
        </div>

        <AssistantTrouble
          v-if="chat.failure"
          :failure="chat.failure"
          class="trouble-block"
          @retry="chat.retry()"
        />
        <p v-if="contextWarning" class="warning">{{ contextWarning }}</p>

        <!-- Openings: an empty box is the hardest thing to answer — and
             "Where was I?" or "Quiz me" are wanted mid-conversation just as
             much as at the start, so the row stays. -->
        <div v-if="configured" class="openings" data-testid="chat-openings">
          <button
            v-for="opening in availableOpenings"
            :key="opening.id"
            type="button"
            class="opening"
            :disabled="chat.sending"
            :data-testid="`opening-${opening.id}`"
            @click="useOpening(opening)"
          >
            {{ t(opening.labelKey as MessageKey) }}
          </button>
        </div>

        <form class="composer" @submit.prevent="submit">
          <!-- The passage travels as a chip you can see and drop, not as a
               sentence of prose that is silently attached. -->
          <div v-if="selection" class="chip" data-testid="selection-chip">
            <span class="chip-quote"
              >“{{ selection.length > 140 ? selection.slice(0, 140) + '…' : selection }}”</span
            >
            <button
              type="button"
              class="chip-drop"
              :aria-label="t('chat.dropSelection')"
              :title="t('chat.remove')"
              data-testid="drop-selection"
              @click="emit('clearSelection')"
            >
              <IconClose class="chip-x" aria-hidden="true" />
            </button>
          </div>

          <div class="controls">
            <label class="control">
              <span class="control-label">{{ t('chat.sends') }}</span>
              <select v-model="contextChoice" data-testid="context-choice">
                <option value="none">{{ t('chat.scopeNone') }}</option>
                <option value="selection" :disabled="!selection">
                  {{ t('chat.scopeSelection') }}
                </option>
                <option value="section">{{ sectionNoun }}</option>
                <option value="book-so-far">{{ t('chat.scopeSoFar') }}</option>
                <option value="whole-book">{{ t('chat.scopeWhole') }}</option>
              </select>
            </label>
            <span
              class="estimate"
              :class="{ over: estimate.overBudget }"
              data-testid="scope-estimate"
              :title="estimate.overBudget ? t('chat.overBudget') : t('chat.estimate')"
            >
              {{ estimate.overBudget ? t('chat.wontFit') : '' }}{{ estimateLabel }}
            </span>
            <span class="control model" data-testid="book-model">
              <span class="control-label">{{ t('chat.model') }}</span>
              <ModelPicker
                v-model="bookModelChoice"
                size="small"
                :label="t('chat.modelForBook')"
                :models="settings.models"
                :favourite-ids="settings.favoriteModelIds"
                :loading="settings.modelsLoading"
                :failure="settings.modelsFailure"
                @reload="settings.loadModels(true)"
                :fallback-label="t('chat.modelDefault')"
                :fallback-detail="settings.modelId || t('chat.modelNoneYet')"
                @toggle-favourite="settings.toggleFavorite"
              />
            </span>
          </div>
          <div class="composer-row">
            <textarea
              ref="composerRef"
              v-model="question"
              rows="2"
              :placeholder="t(typedOn === 'touch' ? 'chat.placeholderTouch' : 'chat.placeholder')"
              data-testid="chat-input"
              @keydown="onComposerKeydown"
            ></textarea>
            <button
              v-if="chat.sending"
              type="button"
              class="stop"
              data-testid="chat-stop"
              :title="t('chat.stopTitle')"
              @click="chat.stop()"
            >
              {{ t('chat.stop') }}
            </button>
            <button
              v-else
              type="submit"
              class="send"
              :disabled="!configured"
              data-testid="chat-send"
            >
              {{ t('chat.send') }}
            </button>
          </div>

        </form>
      </aside>
    </template>
  </div>
</template>

<style scoped>
/* ————— closed: the invitation —————
   Closed, the root must take NO room and cover nothing: it is a flex child of
   the same box that lays out the book, and an empty item that still owns a
   corner is an empty item sitting on the pager. */
.chat-root.closed {
  position: absolute;
  /* Pinned to the END of the row, which is the right in English and the left
     in Arabic — logical, so the plate lands on the reader's own side. */
  inset-block: auto 0;
  inset-inline: auto 0;
  width: 0;
  height: 0;
}
.chat-toggle {
  position: absolute;
  z-index: 30;
  background: var(--gold);
  color: var(--gold-ink);
  border: 1px solid var(--gold);
}
.chat-toggle:hover:not(:disabled) {
  color: var(--gold-ink);
  background: var(--gold-mid);
  border-color: var(--gold-mid);
  box-shadow:
    inset 0 0 0 3px var(--gold-mid),
    inset 0 0 0 4px rgba(23, 18, 8, 0.55),
    0 8px 26px rgba(0, 0, 0, 0.4);
}
/* The plate never floats over the page — at ANY width. A square hanging in the
   bottom-right corner sits on the last words of the page and they can never be
   read: measured, it covered text at 1440px just as surely as at 390px, and
   the only thing that changed with the screen was how often a reader noticed.
   It lives at the right end of the pager row instead, where the stage leaves
   it the width (see ReaderView). One line, not three: the "square" was never
   designed — it was this button wrapping inside a zero-width box.

   It is a member of that row, so it is built like one: the same type and the
   same padding as the contents trigger beside it, sitting on the row's own
   vertical padding. Matching the row's tallest control and its inset is what
   puts the plate's middle on the row's middle — anything hand-tuned drifts the
   moment the type changes. */
.chat-toggle {
  inset-inline-end: 0.9rem;
  /* The row's own vertical padding, and the row's own control height: the
     plate is a member of that row even though it is drawn from another
     component, so it stands the same height on the same line. */
  bottom: 0.5rem;
  height: var(--pager-control-h);
  display: inline-flex;
  align-items: center;
  padding: 0 0.9em;
  font-size: 0.68rem;
  white-space: nowrap;
  box-shadow:
    inset 0 0 0 2px var(--gold),
    inset 0 0 0 3px rgba(23, 18, 8, 0.55);
}

/* ————— open: a share of the reading stage —————
   The stage lays book and assistant out; this root only claims its share, so
   the book is resized rather than covered. */
.chat-root.dock-drawer,
.chat-root.dock-side {
  --chat-gap: 0.7rem;
  display: flex;
  min-height: 0;
  min-width: 0;
  background: var(--bg-panel);
}
.chat-root.dock-drawer {
  flex-direction: column;
  /* A hand's width of stage between the book's last line and the edge the
     reader drags. Without it the page ends ON the grip, and a line of type
     touching a control reads as a mistake in both themes. The gap comes OUT
     of the panel's own share rather than being added to it — a margin on a
     percentage height is a panel 11px bigger than it agreed to be, which on a
     phone is 11px of it off the screen. */
  height: calc(var(--chat-size) - var(--chat-gap));
  margin-block-start: var(--chat-gap);
  width: 100%;
  border-top: 1px solid var(--hair-soft);
}
/* The quiz sheet asks for the room it needs and gives it back on close — the
   drawer's remembered size is a reading preference, not a form's budget. */
.chat-root.dock-drawer.quiz-open {
  height: calc(max(var(--chat-size), 58%) - var(--chat-gap));
}
.chat-root.dock-side {
  flex-direction: row;
  width: calc(var(--chat-size) - var(--chat-gap));
  margin-inline-start: var(--chat-gap);
  height: 100%;
  border-left: 1px solid var(--hair-soft);
}

/* ————— the grip between them ————— */
.grip {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: none;
  border: none;
  /* THE line that makes this draggable with a finger. Without it the browser
     claims the gesture as a scroll a few pixels in and sends pointercancel:
     the edge moves 18px of the 150 you dragged and then stops dead, which
     reads as "the slider does not work". */
  touch-action: none;
}
.dock-drawer .grip {
  height: 0.85rem;
  width: 100%;
  cursor: row-resize;
  margin-top: -0.42rem;
}
.dock-side .grip {
  width: 0.85rem;
  height: 100%;
  cursor: col-resize;
  margin-inline-start: -0.42rem;
}
.grip i {
  display: block;
  background: var(--hair-soft);
  border-radius: 2px;
  transition:
    background 0.2s ease,
    transform 0.2s ease;
}
/* A 13px edge is a mouse's target, not a thumb's. Where the pointer is coarse
   the grip is thick enough to find without looking, and the negative margin
   grows with it so the line it draws does not move. */
@media (pointer: coarse) {
  .dock-drawer .grip {
    height: 1.7rem;
    margin-top: -0.85rem;
  }
  .dock-side .grip {
    width: 1.7rem;
    margin-inline-start: -0.85rem;
  }
}
.dock-drawer .grip i {
  width: 3.2rem;
  height: 2px;
}
.dock-side .grip i {
  width: 2px;
  height: 3.2rem;
}
.grip:hover i,
.grip:focus-visible i,
.dragging .grip i {
  background: var(--gold);
  transform: scale(1.1);
}
.grip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

/* ————— the panel ————— */
.chat-panel {
  /* The quiz sheet lays over this panel, so it must be the containing block. */
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  /* No `overflow: hidden` here, however tempting: the model picker's sheet
     hangs out of the panel by design, and clipping it leaves half a menu with
     the book's iframe swallowing the clicks. What keeps the composer on the
     screen is the flex arithmetic below — the conversation yields first, and
     the composer does not yield at all. */
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.2rem 1rem 0.9rem;
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid var(--hair-soft);
}
.chat-header strong {
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 0.62rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--gold);
}
.place,
.spoiler-state {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.14em;
  color: var(--text-faint);
  white-space: nowrap;
}
.spoiler-state[data-safe='false'] {
  color: var(--gold-mid);
}
.header-actions {
  margin-inline-start: auto;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.ghost {
  border-color: transparent;
  color: var(--text-faint);
  font-size: 0.55rem;
  padding: 0.35em 0.7em;
}
.ghost:hover:not(:disabled) {
  border-color: var(--hair-soft);
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  border-color: transparent;
  border-radius: 50%;
  color: var(--text-faint);
}
.icon-btn:hover:not(:disabled) {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.ctl-icon {
  width: 14px;
  height: 14px;
  display: block;
}

/* ————— the conversation ————— */
.messages {
  /* The conversation ASKS for a readable amount of room (7rem) and takes any
     that is going spare — but it yields when there is none. It used to demand
     those 7rem outright, and a short drawer with a setup notice in it had no
     way to pay: the panel's content grew past the panel, and what hung out of
     the bottom, off the screen, was the composer and the model picker. The
     thing you type in is the last thing that should be pushed out of a panel
     for talking. So it takes the room left over (basis 0, grow 1) instead of
     claiming a share the panel may not have. */
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  /* A comfortable measure even when the drawer is as wide as the book. */
  padding-inline-end: 0.4rem;
}
.messages > * {
  max-width: 46rem;
}
.opener-lede {
  margin: 0.6rem 0 0;
  color: var(--text-faint);
  font-size: 0.9rem;
  max-width: 40rem;
}

/* ————— openings ————— */
.openings {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.opening {
  font-size: 0.56rem;
  padding: 0.45em 0.85em;
  color: var(--text-dim);
}
.opening:hover:not(:disabled) {
  color: var(--gold);
}

/* ————— the composer ————— */
.composer {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.chip {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem 0.4rem 0.7rem;
  border: 1px solid var(--hair-soft);
  border-left: 2px solid var(--hair);
  border-radius: 3px;
  background: var(--bg-raise);
}
.chip-quote {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  font-style: italic;
  color: var(--text-dim);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.chip-drop {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border-color: transparent;
  border-radius: 50%;
  color: var(--text-faint);
}
.chip-drop:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.chip-x {
  width: 10px;
  height: 10px;
  display: block;
}
.composer-row {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}
.composer-row textarea {
  flex: 1;
  resize: none;
  min-height: 3.1rem;
  max-height: 40vh;
  font-size: 0.95rem;
  line-height: 1.5;
}
.send,
.stop {
  align-self: stretch;
  padding-inline: 1.3em;
  white-space: nowrap;
}
.send {
  color: var(--gold);
  border-color: var(--hair);
}
.send:hover:not(:disabled) {
  color: var(--gold-ink);
  background: var(--gold);
}
.stop {
  color: var(--danger);
  border-color: rgba(224, 162, 162, 0.35);
}

/* ————— what travels with the question ————— */
/* ————— what the question carries, above the box it is typed in —————
   These two decide what a question COSTS, so they are read before it is
   written, not found underneath it after — and on a phone the picker at the
   bottom of the panel could be scrolled off the screen entirely.

   The panel is the container they answer to, not the window: detached to a
   narrow column on a wide screen it is as tight as a phone, and a media query
   would call it roomy. */
.composer {
  container-type: inline-size;
  /* Whatever else gives, the box you type in does not. */
  flex-shrink: 0;
}
.controls {
  display: flex;
  align-items: center;
  gap: 0.4rem 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.45rem;
}
/* Narrow: the two controls share the line and the price takes one of its own
   underneath, rather than each landing on a line of its own and spending three
   lines of a phone's height on two words and a number. */
@container (max-width: 27rem) {
  .controls {
    gap: 0.3rem 0.6rem;
  }
  .controls .control {
    flex: 1 1 0;
    min-width: 0;
  }
  .controls .control select {
    min-width: 0;
    width: 100%;
  }
  .controls .estimate {
    order: 3;
    flex-basis: 100%;
  }
  .controls .model {
    margin-inline-start: 0;
  }
}
.control {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.control-label {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.control select {
  font-size: 0.78rem;
  padding: 0.3em 0.5em;
}
/* The picker owns its own trigger width; the row only says where it sits. */
.model {
  position: relative;
  min-width: 0;
}
.estimate {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  white-space: nowrap;
}
.estimate.over {
  color: var(--danger);
}
.model {
  margin-inline-start: auto;
}

.trouble-block {
  margin: 0.2rem 0;
  /* It can be read by scrolling; it cannot push the composer off the panel. */
  min-height: 0;
  overflow-y: auto;
}
.warning {
  color: var(--gold-mid);
  margin: 0;
  font-size: 0.82rem;
}

/* ————— the two docks on a phone —————
   A phone has no room to put the book and the assistant side by side, so the
   side dock means something else there: the WHOLE screen. It leaves the flow
   entirely (fixed, above everything) rather than taking a share of a row that
   has none to give — which is what used to squeeze the book to nothing and let
   the lamp and the dog-ear draw over the conversation. The drawer keeps its
   share of the height, so the two docks stay two genuinely different things:
   a glance at the book while you talk, or the talk alone. */
@media (max-width: 46rem) {
  .chat-root.dock-side {
    position: fixed;
    inset: 0;
    /* The whole screen means the whole screen: there is no book beside it to
       keep clear of, so the gap goes to nothing rather than pushing the panel
       11px off the edge. */
    --chat-gap: 0px;
    width: 100%;
    height: 100%;
    /* Over the lamp (20), the dog-ear (15) and the menus (45). */
    z-index: 90;
    flex-direction: column;
    border-left: none;
  }
  /* Nothing to resize when it owns the screen. */
  .dock-side .grip {
    display: none;
  }
  /* A drawer with the setup notice in it is a drawer whose whole content is
     that notice: there is no conversation yet, and the words that say why are
     the reason to open the panel at all. So it asks for the room to show them
     — as a MINIMUM, so a reader who has dragged it larger keeps their size,
     and it goes back to normal the moment there is a key. */
  .chat-root.dock-drawer.needs-setup {
    height: calc(max(var(--chat-size), 56%) - var(--chat-gap));
  }
  /* Full screen, this panel is drawn OVER the reader, so it has to stand
     aside when something app-wide opens over both — the settings the setup
     notice sends you to used to open behind it, which reads as a link that
     does nothing. */
  .chat-root.dock-side.under-overlay {
    z-index: 10;
  }
  .chat-panel {
    padding-top: 0.6rem;
    /* Clear of the phone's own furniture at both ends, and clear of the very
       bottom edge: a button flush against it is a button a thumb has to be
       precise about, on the one device where precision is hardest. */
    padding-bottom: max(1.35rem, calc(env(safe-area-inset-bottom) + 0.6rem));
  }
  .model {
    margin-inline-start: 0;
  }
}
</style>
