<script setup lang="ts">
/**
 * A gloss in the margin: one word, the sentence it came from, and two lines
 * saying what it means there.
 *
 * It shares the side slot with Bookmarks and Search because it is the same
 * kind of thing — something the reader summoned, which stays until dismissed
 * — and because that slot is already the one place in the reader where a panel
 * is allowed to sit.
 */
import { useLookupStore } from '@/stores/lookup'
import AssistantTrouble from '@/components/chat/AssistantTrouble.vue'
import IconClose from '@/components/icons/IconClose.vue'
import IconGloss from '@/components/icons/IconGloss.vue'
import { useI18n } from '@/i18n'

const emit = defineEmits<{ ask: [text: string]; close: [] }>()

const lookup = useLookupStore()
const { t } = useI18n()
</script>

<template>
  <aside
    class="lookup-card"
    data-testid="lookup-card"
    :aria-label="t('lookup.of', { word: lookup.term ?? '' })"
  >
    <header>
      <IconGloss class="gloss-mark" aria-hidden="true" />
      <strong class="term" data-testid="lookup-term">{{ lookup.term }}</strong>
      <button
        type="button"
        class="x-btn"
        data-testid="lookup-close"
        :aria-label="t('lookup.close')"
        :title="t('lookup.close')"
        @click="emit('close')"
      >
        <IconClose class="x-icon" aria-hidden="true" />
      </button>
    </header>

    <!-- The sentence the answer was given about, so a wrong answer is legible
         as an answer to the wrong sentence. -->
    <p v-if="lookup.sentence" class="sentence" data-testid="lookup-sentence">
      {{ lookup.sentence }}
    </p>

    <AssistantTrouble
      v-if="lookup.failure"
      :failure="lookup.failure"
      data-testid="lookup-error"
      @retry="lookup.retry()"
    />
    <p
      v-else-if="lookup.pending && lookup.answer.length === 0"
      class="waiting"
      data-testid="lookup-waiting"
    >
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      <span class="sr-only">{{ t('lookup.working') }}</span>
    </p>
    <p v-else class="gloss" data-testid="lookup-answer">{{ lookup.answer }}</p>

    <footer v-if="!lookup.failure">
      <button
        type="button"
        class="more"
        data-testid="lookup-ask-more"
        @click="emit('ask', lookup.sentence || (lookup.term ?? ''))"
      >
        {{ t('lookup.askMore') }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.lookup-card {
  width: 100%;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: var(--bg-panel);
  padding: 0.75rem 0.85rem 0.7rem;
  box-shadow: var(--shadow);
}
header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.35rem;
}
.gloss-mark {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  color: var(--gold-mid);
}
.term {
  flex: 1;
  min-width: 0;
  font-family: var(--font-display, inherit);
  font-size: 0.98rem;
  letter-spacing: 0.02em;
  color: var(--text);
  overflow-wrap: anywhere;
}
.x-btn {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: none;
  color: var(--text-faint);
}
.x-btn:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
  background: none;
}
.x-icon {
  width: 13px;
  height: 13px;
  display: block;
}
/* The sentence is quoted material, so it is set like the excerpts in the
   marks panel: quieter than the answer, and folded when it runs long. */
.sentence {
  margin: 0 0 0.5rem;
  padding-inline-start: 0.55rem;
  border-inline-start: 1px solid var(--hair-soft);
  color: var(--text-faint);
  font-size: 0.76rem;
  line-height: 1.5;
  font-style: italic;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gloss {
  margin: 0;
  color: var(--text);
  font-size: 0.88rem;
  line-height: 1.55;
  white-space: pre-wrap;
}
/* Three dots breathing, rather than a spinner: the wait is a second or two. */
.waiting {
  display: flex;
  gap: 0.3rem;
  margin: 0.2rem 0 0.1rem;
}
.dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--gold-mid);
  opacity: 0.35;
  animation: gloss-breathe 1.1s ease-in-out infinite;
}
.dot:nth-child(2) {
  animation-delay: 0.16s;
}
.dot:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes gloss-breathe {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none;
    opacity: 0.55;
  }
}
footer {
  margin-top: 0.55rem;
}
/* A quiet nudge, not a button — the same voice as the marks panel's crossover. */
.more {
  padding: 0;
  border: none;
  background: none;
  color: var(--gold);
  font-size: 0.68rem;
}
.more:hover {
  border: none;
  text-decoration: underline;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
