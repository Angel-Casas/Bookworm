<script setup lang="ts">
/**
 * The label on one shelf: its name, how many books stand on it, and the two
 * things a reader does to a shelf from the outside — fold it away, or open it
 * up to change it. The loose shelf (books on no shelf) can be folded, not
 * edited: there is nothing to rename.
 */
import { computed } from 'vue'
import { useI18n } from '@/i18n'

const props = defineProps<{ topic: string | null; count: number; folded: boolean }>()
const emit = defineEmits<{ fold: []; edit: [] }>()

const { t } = useI18n()
const name = computed(() => props.topic ?? t('shelves.loose'))
</script>

<template>
  <header class="shelf-heading" :class="{ loose: topic === null }">
    <button
      type="button"
      class="fold"
      :aria-expanded="!folded"
      :aria-label="folded ? t('shelves.unfold', { name }) : t('shelves.fold', { name })"
      data-testid="shelf-fold"
      @click="emit('fold')"
    >
      <span class="chevron" :class="{ shut: folded }" aria-hidden="true">▾</span>
      <h2 class="name">{{ name }}</h2>
      <span class="count">{{ t('shelves.count', { count }) }}</span>
    </button>
    <i class="rule" aria-hidden="true"></i>
    <button
      v-if="topic !== null"
      type="button"
      class="edit"
      data-testid="shelf-edit"
      :aria-label="t('shelves.editNamed', { name })"
      @click="emit('edit')"
    >
      {{ t('shelves.edit') }}
    </button>
  </header>
</template>

<style scoped>
.shelf-heading {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin: 2.1rem 0 0.9rem;
}
.fold {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border: 0;
  background: none;
  text-transform: none;
  letter-spacing: 0;
  min-height: 2.75rem;
}
.fold:hover:not(:disabled) {
  border: 0;
}
.chevron {
  display: inline-block;
  width: 0.8rem;
  color: var(--gold);
  font-size: 0.8rem;
  transition: transform 0.2s ease;
}
.chevron.shut {
  transform: rotate(-90deg);
}
.name {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
}
.loose .name,
.loose .chevron {
  color: var(--text-faint);
}
.count {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.rule {
  flex: 1;
  height: 1px;
  background: var(--hair-soft);
}
.edit {
  font-size: 0.58rem;
  padding: 0.45em 0.9em;
}
</style>
