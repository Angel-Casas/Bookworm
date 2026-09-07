<script setup lang="ts">
/**
 * The assistant, unable to answer, saying why and what to do.
 *
 * Every place that can talk to the model shows this same block — the chat and
 * the word lookup today — so a rejected key reads identically wherever the
 * reader meets it, and there is always exactly one thing to press.
 */
import type { Failure } from '@/lib/failure'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ failure: Failure }>()
const emit = defineEmits<{ retry: [] }>()

const ui = useUiStore()

function act(): void {
  // Settings opens OVER the book. Sending a reader to another page to fix a
  // key would cost them their place to fix a thing that takes four seconds.
  if (props.failure.action === 'settings') ui.toggleOverlay('settings')
  else emit('retry')
}
</script>

<template>
  <div class="trouble" role="alert" data-testid="trouble" :data-kind="failure.kind">
    <p class="what">{{ failure.message }}</p>
    <button
      v-if="failure.action"
      type="button"
      class="fix"
      :data-testid="failure.action === 'settings' ? 'trouble-settings' : 'trouble-retry'"
      @click="act"
    >
      {{ failure.actionLabel }}
    </button>
  </div>
</template>

<style scoped>
/* A hairline at the start rather than a red box: something went wrong, and
   the reader is still reading a book. */
.trouble {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.75rem;
  padding-inline-start: 0.6rem;
  border-inline-start: 2px solid var(--danger);
}
.what {
  flex: 1 1 14rem;
  min-width: 0;
  margin: 0;
  color: var(--text-dim);
  font-size: 0.84rem;
  line-height: 1.5;
}
.fix {
  flex-shrink: 0;
  font-size: 0.58rem;
}
</style>
