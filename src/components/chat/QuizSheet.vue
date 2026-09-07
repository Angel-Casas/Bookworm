<script setup lang="ts">
/**
 * Setting up a quiz, over the conversation.
 *
 * "Quiz me" is the one opening a reader has opinions about BEFORE it runs —
 * how many, over how much of the book, and whether they want to be asked what
 * happened or why. So it is the one opening that asks first.
 *
 * The sheet covers the assistant rather than opening beside it: for the few
 * seconds this takes, setting up the quiz IS the panel's job, and a form
 * squeezed under a conversation would be a worse version of both. Every
 * control writes into the prompt shown at the bottom, and that prompt is
 * exactly what is sent — edit it and the controls stand aside.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  clampQuizCount,
  composeQuizPrompt,
  QUIZ_COUNT_MAX,
  QUIZ_COUNT_MIN,
  QUIZ_COUNTS,
  QUIZ_KINDS,
  QUIZ_SCOPES,
  type QuizSetup,
} from '@/lib/quiz'
import IconClose from '@/components/icons/IconClose.vue'
import { useI18n, type MessageKey } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{
  setup: QuizSetup
  /** Size and price of what this scope will send, from the assistant. */
  estimateLabel: string
  estimateOver: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:setup': [setup: QuizSetup]
  close: []
  start: [prompt: string]
}>()

const prompt = ref('')
/** Once the reader edits the prompt, the controls stop rewriting it. */
const edited = ref(false)
const promptRef = ref<HTMLTextAreaElement | null>(null)
const firstRef = ref<HTMLButtonElement | null>(null)

const composed = computed(() => composeQuizPrompt(props.setup))
const spoilers = computed(() => props.setup.scope === 'whole-book')

watch(
  composed,
  (next) => {
    if (!edited.value) prompt.value = next
  },
  { immediate: true },
)

onMounted(() => {
  void nextTick(() => firstRef.value?.focus())
})

function change(patch: Partial<QuizSetup>): void {
  emit('update:setup', { ...props.setup, ...patch })
}

function setCount(value: number): void {
  change({ count: clampQuizCount(value) })
}

function onCountInput(event: Event): void {
  setCount(Number((event.target as HTMLInputElement).value))
}

/** Put the composed prompt back, and let the controls drive it again. */
function resetPrompt(): void {
  edited.value = false
  prompt.value = composed.value
  void nextTick(() => promptRef.value?.focus())
}

function start(): void {
  const text = prompt.value.trim()
  if (text.length === 0 || props.busy) return
  emit('start', text)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  // The prompt box takes plain Enter for new lines, so starting is deliberate.
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    start()
  }
}
</script>

<template>
  <div
    class="quiz-sheet"
    role="dialog"
    aria-modal="true"
    :aria-label="t('quiz.setup')"
    data-testid="quiz-sheet"
    @keydown="onKeydown"
  >
    <header class="quiz-head">
      <strong>{{ t('quiz.title') }}</strong>
      <span class="lede">{{ t('quiz.lede') }}</span>
      <button
        type="button"
        class="icon-btn"
        data-testid="quiz-close"
        :aria-label="t('quiz.close')"
        :title="t('overlay.close')"
        @click="emit('close')"
      >
        <IconClose class="ctl-icon" aria-hidden="true" />
      </button>
    </header>

    <div class="quiz-body">
      <div class="col">
        <fieldset class="field">
          <legend>{{ t('quiz.howMany') }}</legend>
          <div class="chips">
            <button
              v-for="(option, index) in QUIZ_COUNTS"
              :key="option"
              :ref="
                (el) => {
                  if (index === 0) firstRef = el as HTMLButtonElement
                }
              "
              type="button"
              class="chip"
              :class="{ on: setup.count === option }"
              :aria-pressed="setup.count === option"
              :data-testid="`quiz-count-${option}`"
              @click="setCount(option)"
            >
              {{ option }}
            </button>
            <label class="count-other">
              <span class="sr-only">{{ t('quiz.count') }}</span>
              <input
                type="number"
                :min="QUIZ_COUNT_MIN"
                :max="QUIZ_COUNT_MAX"
                :value="setup.count"
                data-testid="quiz-count-input"
                @input="onCountInput"
              />
            </label>
          </div>
        </fieldset>

        <fieldset class="field">
          <legend>{{ t('quiz.howItRuns') }}</legend>
          <label class="switch">
            <input
              type="checkbox"
              :checked="setup.oneAtATime"
              data-testid="quiz-one-at-a-time"
              @change="change({ oneAtATime: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <span class="switch-label">{{ t('quiz.oneAtATime') }}</span>
              <span class="switch-hint">{{ t('quiz.oneAtATimeHint') }}</span>
            </span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              :checked="setup.cite"
              data-testid="quiz-cite"
              @change="change({ cite: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <span class="switch-label">{{ t('quiz.cite') }}</span>
              <span class="switch-hint">{{ t('quiz.citeHint') }}</span>
            </span>
          </label>
        </fieldset>
      </div>

      <div class="col">
        <fieldset class="field">
          <legend>{{ t('quiz.overWhat') }}</legend>
          <div class="chips stacked">
            <button
              v-for="option in QUIZ_SCOPES"
              :key="option.id"
              type="button"
              class="chip wide"
              :class="{ on: setup.scope === option.id }"
              :aria-pressed="setup.scope === option.id"
              :data-testid="`quiz-scope-${option.id}`"
              @click="change({ scope: option.id })"
            >
              <span class="chip-label">{{ t(option.labelKey as MessageKey) }}</span>
              <span class="chip-hint">{{ t(option.hintKey as MessageKey) }}</span>
            </button>
          </div>
          <!-- Scope owns the spoiler decision here too — there is no second box. -->
          <p v-if="spoilers" class="warn" data-testid="quiz-spoiler">
            This quiz can ask about anything in the book, including what you have not reached.
          </p>
        </fieldset>

        <fieldset class="field">
          <legend>{{ t('quiz.whatKind') }}</legend>
          <div class="chips stacked">
            <button
              v-for="option in QUIZ_KINDS"
              :key="option.id"
              type="button"
              class="chip wide"
              :class="{ on: setup.kind === option.id }"
              :aria-pressed="setup.kind === option.id"
              :data-testid="`quiz-kind-${option.id}`"
              @click="change({ kind: option.id })"
            >
              <span class="chip-label">{{ t(option.labelKey as MessageKey) }}</span>
              <span class="chip-hint">{{ t(option.hintKey as MessageKey) }}</span>
            </button>
          </div>
        </fieldset>
      </div>

      <fieldset class="field prompt-field">
        <legend>
          What gets sent
          <button
            v-if="edited"
            type="button"
            class="linky"
            data-testid="quiz-reset"
            @click="resetPrompt"
          >
            reset
          </button>
        </legend>
        <textarea
          ref="promptRef"
          v-model="prompt"
          rows="6"
          :aria-label="t('quiz.instruction')"
          data-testid="quiz-prompt"
          @input="edited = true"
        ></textarea>
        <p class="hint">
          {{ edited ? t('quiz.yours') : t('quiz.notYours') }}
        </p>
      </fieldset>
    </div>

    <footer class="quiz-foot">
      <span
        class="estimate"
        :class="{ over: estimateOver }"
        data-testid="quiz-estimate"
        :title="estimateOver ? t('chat.overBudget') : t('quiz.estimate')"
      >
        {{ estimateOver ? "won't fit · " : '' }}{{ estimateLabel }}
      </span>
      <button type="button" class="ghost" data-testid="quiz-cancel" @click="emit('close')">
        Cancel
      </button>
      <button
        type="button"
        class="start"
        :disabled="busy || prompt.trim().length === 0"
        data-testid="quiz-start"
        @click="start"
      >
        Start the quiz
      </button>
    </footer>
  </div>
</template>

<style scoped>
.quiz-sheet {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  /* inset:0 lands on the panel's PADDING box, so the sheet carries the
     panel's own padding to keep its edges off the border. */
  padding: 0.2rem 1rem 0.9rem;
  background: var(--bg-panel);
  /* The sheet answers to its OWN width, not the window's: detached to the
     side it is a narrow column inside a wide screen, and a viewport media
     query would give it three columns in a space that fits one. */
  container-type: inline-size;
}

.quiz-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0 0 0.5rem;
  border-bottom: 1px solid var(--hair-soft);
}
.quiz-head strong {
  font-family: var(--font-display, 'Cinzel', serif);
  letter-spacing: 0.08em;
}
.lede {
  flex: 1;
  color: var(--text-faint);
  font-size: 0.82rem;
}
.icon-btn {
  align-self: center;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border-color: transparent;
  border-radius: 50%;
  color: var(--text-faint);
}
.icon-btn:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.ctl-icon {
  width: 12px;
  height: 12px;
  display: block;
}

/* Three columns, because the drawer is WIDE and SHORT: stacking the groups
   would push the prompt — the thing the reader came to check — below the
   fold. The prompt takes the last column and its full height. */
.quiz-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.8rem 0.2rem 0.2rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: 0.9rem 1.8rem;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  min-width: 0;
}
.field {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.field legend {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0;
  margin-bottom: 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.prompt-field {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chips {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.chips.stacked {
  flex-direction: column;
  align-items: stretch;
}
.chip {
  padding: 0.45em 0.8em;
  font-size: 0.56rem;
  color: var(--text-dim);
  border-color: var(--hair-soft);
}
.chip:hover:not(:disabled) {
  color: var(--gold);
}
/* Hovering a button already turns it gold app-wide, so CHOSEN needs to differ
   by more than colour or the pointer looks like the answer. */
.chip.on {
  color: var(--gold);
  border-color: var(--gold-deep, var(--hair));
  background: rgba(209, 146, 30, 0.09);
  box-shadow: inset 2px 0 0 var(--gold);
}
.chip.wide {
  display: flex;
  justify-content: flex-start;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.15rem 0.55rem;
  text-align: start;
  min-width: 0;
}
.chip-hint {
  font-family: var(--font-body, 'EB Garamond', Georgia, serif);
  font-size: 0.8rem;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-faint);
}
.count-other input {
  width: 3.4rem;
  padding: 0.3em 0.4em;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  text-align: center;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.switch {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-bottom: 0.45rem;
  cursor: pointer;
  max-width: 22rem;
}
.switch input {
  margin-top: 0.25rem;
  accent-color: var(--gold);
}
.switch-label,
.switch-hint {
  display: block;
}
.switch-label {
  font-size: 0.88rem;
  color: var(--text);
}
.switch-hint {
  font-size: 0.78rem;
  color: var(--text-faint);
}

.prompt-field textarea {
  width: 100%;
  flex: 1;
  min-height: 8rem;
  resize: vertical;
  font-family: var(--font-body, 'EB Garamond', Georgia, serif);
  font-size: 0.9rem;
  line-height: 1.5;
}
.hint {
  margin: 0.3rem 0 0;
  color: var(--text-faint);
  font-size: 0.76rem;
}
.linky {
  border: none;
  padding: 0;
  background: none;
  color: var(--gold);
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.16em;
}
.linky:hover {
  border: none;
  text-decoration: underline;
}
.warn {
  margin: 0.4rem 0 0;
  color: var(--gold-mid);
  font-size: 0.8rem;
  max-width: 22rem;
}

.quiz-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--hair-soft);
}
.estimate {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.estimate.over {
  color: var(--danger);
}
.ghost {
  border-color: transparent;
  color: var(--text-faint);
}
.ghost:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.start {
  color: var(--gold);
  border-color: var(--hair);
}

/* Detached to the side, or on a phone, there is only ever one column. */
@container (max-width: 52rem) {
  .quiz-body {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.9rem;
  }
}
</style>
