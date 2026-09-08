<script setup lang="ts">
/**
 * A newer Bookworm is here; would you like it?
 *
 * Deliberately a small plate at the foot of the screen rather than an overlay.
 * A reader mid-paragraph has not asked for a decision, and an update is never
 * urgent enough to take the page away — so this sits under everything the app
 * itself opens, waits, and goes quietly if waved off.
 */
import { useI18n } from '@/i18n'
import { useUpdateStore } from '@/stores/update'
import IconClose from '@/components/icons/IconClose.vue'

const { t } = useI18n()
const update = useUpdateStore()
</script>

<template>
  <Transition name="notice-rise">
    <div
      v-if="update.waiting && !update.dismissed"
      class="notice"
      role="status"
      data-testid="update-notice"
    >
      <p class="words">{{ t('update.ready') }}</p>
      <button
        type="button"
        class="take"
        :disabled="update.applying"
        data-testid="update-take"
        @click="update.take()"
      >
        {{ update.applying ? t('update.taking') : t('update.take') }}
      </button>
      <button
        type="button"
        class="later"
        :aria-label="t('update.later')"
        :title="t('update.later')"
        data-testid="update-later"
        @click="update.dismiss()"
      >
        <IconClose class="later-icon" aria-hidden="true" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.notice {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  margin-inline: auto;
  /* Clear of a phone's home bar, which is exactly where a thumb is least
     accurate (see Docs/LESSONS.md on controls flush to the bottom edge). */
  margin-bottom: max(0.75rem, env(safe-area-inset-bottom));
  width: fit-content;
  max-width: calc(100vw - 1.5rem);
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.6rem 0.55rem 0.9rem;
  background: var(--bg-panel);
  border: 1px solid var(--gold-deep);
  border-radius: 3px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
  /* Under the nav (70) and every overlay (60): an update can always wait for
     whatever the reader opened on purpose. */
  z-index: 40;
}
.words {
  margin: 0;
  color: var(--text-dim);
  font-family: var(--font-serif);
  font-size: 0.85rem;
  line-height: 1.35;
}
.take {
  flex: none;
  font-size: 0.58rem;
  border-color: var(--gold-deep);
  color: var(--gold);
}
.later {
  flex: none;
  display: inline-flex;
  padding: 0.3rem;
  border: none;
  background: none;
  color: var(--text-faint);
}
.later:hover {
  border: none;
  color: var(--gold);
}
.later-icon {
  width: 0.75rem;
  height: 0.75rem;
}
.notice-rise-enter-active,
.notice-rise-leave-active {
  transition:
    opacity 0.28s ease,
    transform 0.28s cubic-bezier(0.32, 0.72, 0.2, 1);
}
.notice-rise-enter-from,
.notice-rise-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (prefers-reduced-motion: reduce) {
  .notice-rise-enter-active,
  .notice-rise-leave-active {
    transition: none;
  }
}
</style>
