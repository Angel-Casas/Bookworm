<script setup lang="ts">
/**
 * One turn of the conversation.
 *
 * An assistant answer is rendered as markdown (the model writes in it, and a
 * `<p>` of raw asterisks was the panel's worst quality problem) and its
 * citations become buttons that turn the book. The renderer escapes its input
 * before adding any tag of its own, so `v-html` here is fed only markup this
 * app produced — see src/lib/markdown.ts.
 */
import { computed } from 'vue'
import { parseCitations, type CitationSource } from '@/lib/citation'
import { escapeHtml, renderMarkdown } from '@/lib/markdown'
import IconNote from '@/components/icons/IconNote.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  referenceLabels?: readonly string[]
  /** Labels the answer may cite, with where each one lives in the book. */
  sources?: readonly CitationSource[]
  /** True while this answer is still arriving. */
  streaming?: boolean
  kept?: boolean
}>()

const emit = defineEmits<{
  jump: [position: string]
  keep: []
  copy: []
}>()

/**
 * The answer as one piece of markup, citations included.
 *
 * Rendering the prose runs between citations SEPARATELY looks equivalent and
 * isn't, twice over: markdown is a block language, so "…threshold [Chapter 4].
 * The second…" becomes three fragments and the orphaned full stop turns into a
 * paragraph of its own; and slicing the rendered HTML at a citation cuts
 * through the middle of a `<p>`, leaving both halves unbalanced.
 *
 * So the citation travels through the renderer as a placeholder — private-use
 * code points, which cannot occur in a book and which the renderer treats as
 * ordinary text — and is swapped for a button afterwards. Everything in that
 * button is either a fixed string or escaped by us; the label is the reader's
 * own book, escaped like any other text.
 */
const OPEN = '\uE000'
const CLOSE = '\uE001'

const html = computed(() => {
  if (props.role !== 'assistant') return ''
  const split = parseCitations(props.content, props.sources ?? [])
  const citations = split.filter((part) => part.kind === 'citation')
  let index = -1
  const rendered = renderMarkdown(
    split
      .map((part) => (part.kind === 'citation' ? `${OPEN}${(index += 1)}${CLOSE}` : part.text))
      .join(''),
  )
  return rendered.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_match, digits: string) => {
    const citation = citations[Number(digits)]
    if (!citation) return ''
    const label = escapeHtml(citation.text)
    return `<button type="button" class="cite" data-testid="citation" data-cite="${escapeHtml(
      citation.position ?? '',
    )}" title="${escapeHtml(t('message.goTo', { label }))}">${label}</button>`
  })
})

/** Citations are markup, so their clicks are caught on the way out. */
function onAnswerClick(event: MouseEvent): void {
  const target = (event.target as Element | null)?.closest('[data-cite]')
  const position = target?.getAttribute('data-cite')
  if (position) emit('jump', position)
}
</script>

<template>
  <div class="message" :class="role" :data-role="role">
    <div class="turn-head">
      <span class="who">{{ role === 'user' ? 'You' : 'Bookworm' }}</span>
      <span
        v-if="referenceLabels && referenceLabels.length > 0"
        class="sent"
        data-testid="sent-context"
      >
        {{ referenceLabels.join(' · ') }}
      </span>
      <div v-if="role === 'assistant' && !streaming && content.length > 0" class="turn-actions">
        <button type="button" class="turn-action" title="Copy" @click="emit('copy')">Copy</button>
        <button
          type="button"
          class="turn-action"
          :class="{ kept }"
          :title="kept ? t('message.kept') : t('message.keep')"
          data-testid="keep-answer"
          @click="emit('keep')"
        >
          <IconNote class="keep-icon" aria-hidden="true" />
          {{ kept ? 'Kept' : 'Keep' }}
        </button>
      </div>
    </div>

    <p v-if="role === 'user'" class="said">{{ content }}</p>

    <div v-else class="answer" data-testid="answer" @click="onAnswerClick">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span class="prose" v-html="html"></span>
      <span v-if="streaming" class="cursor" aria-hidden="true"></span>
      <span v-if="streaming" class="sr-only">Answering…</span>
    </div>
  </div>
</template>

<style scoped>
/* A turn arriving. A CSS animation rather than a <Transition>: it should play
   once, when the element is created, and NOT replay while the answer streams
   in under it (see LESSONS on interrupted enter lifecycles). */
@keyframes turn-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
.message {
  animation: turn-in 0.26s var(--ease-wipe) both;
  padding: 0.55rem 0 0.75rem;
  border-bottom: 1px solid var(--hair-soft);
}
.message:last-child {
  border-bottom: none;
}
.turn-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin-bottom: 0.2rem;
}
.who {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
  flex-shrink: 0;
}
.assistant .who {
  color: var(--gold);
}
.sent {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  opacity: 0.7;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Actions stay out of the way until the turn is hovered or focused within. */
.turn-actions {
  margin-inline-start: auto;
  display: flex;
  gap: 0.3rem;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.message:hover .turn-actions,
.message:focus-within .turn-actions {
  opacity: 1;
}
.turn-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3em 0.6em;
  font-size: 0.55rem;
  border-color: transparent;
  color: var(--text-faint);
}
.turn-action:hover:not(:disabled) {
  border-color: var(--hair-soft);
}
.turn-action.kept {
  color: var(--gold);
  opacity: 1;
}
.keep-icon {
  width: 11px;
  height: 11px;
}
.said {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-dim);
  white-space: pre-wrap;
}

/* ————— the answer ————— */
.answer {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text);
}
.prose {
  display: contents;
}
.answer :deep(p) {
  margin: 0 0 0.6rem;
}
.answer :deep(p:last-child) {
  margin-bottom: 0;
}
.answer :deep(h3),
.answer :deep(h4),
.answer :deep(h5),
.answer :deep(h6) {
  font-family: var(--font-display, 'Cinzel', serif);
  font-weight: 500;
  font-size: 0.92rem;
  letter-spacing: 0.02em;
  color: var(--gold);
  margin: 0.9rem 0 0.35rem;
}
.answer :deep(ul),
.answer :deep(ol) {
  margin: 0 0 0.6rem;
  padding-inline-start: 1.15rem;
}
.answer :deep(li) {
  margin-bottom: 0.2rem;
}
.answer :deep(li::marker) {
  color: var(--gold-deep);
}
/* A quoted passage is the book's own voice: set it apart from the model's. */
.answer :deep(blockquote) {
  margin: 0.6rem 0;
  padding: 0.1rem 0 0.1rem 0.9rem;
  border-left: 2px solid var(--hair);
  font-style: italic;
  color: var(--text-dim);
}
.answer :deep(blockquote p) {
  margin: 0 0 0.3rem;
}
.answer :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: rgba(209, 146, 30, 0.08);
  padding: 0.1em 0.35em;
  border-radius: 2px;
}
.answer :deep(pre) {
  margin: 0 0 0.6rem;
  padding: 0.6rem 0.8rem;
  overflow-x: auto;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: var(--bg-raise);
}
.answer :deep(pre code) {
  background: none;
  padding: 0;
}
.answer :deep(hr) {
  border: none;
  border-top: 1px solid var(--hair-soft);
  margin: 0.8rem 0;
}
.answer :deep(strong) {
  color: var(--text);
  font-weight: 600;
}

/* ————— citations: a door back into the book —————
   Rendered inside the answer's markup, so reached through :deep(). */
.answer :deep(.cite) {
  display: inline;
  padding: 0.05em 0.4em;
  margin: 0 0.1em;
  font-family: var(--font-mono);
  font-size: 0.62em;
  letter-spacing: 0.08em;
  text-transform: none;
  vertical-align: 0.08em;
  color: var(--gold-mid);
  border: 1px solid var(--hair-soft);
  border-radius: 2px;
  background: none;
}
.answer :deep(.cite:hover) {
  color: var(--gold-ink);
  background: var(--gold);
  border-color: var(--gold);
}

/* The answer is still arriving. */
.cursor {
  display: inline-block;
  width: 0.45em;
  height: 1em;
  vertical-align: -0.15em;
  margin-inline-start: 0.15em;
  background: var(--gold);
  animation: blink 1.05s steps(2, start) infinite;
}
@keyframes blink {
  to {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cursor {
    animation: none;
    opacity: 0.6;
  }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
