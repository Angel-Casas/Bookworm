<script setup lang="ts">
import { LANGUAGES } from '@/lib/language'
import { useLanguageStore } from '@/stores/language'
import OverlayShell from './OverlayShell.vue'
import { useI18n } from '@/i18n'

const emit = defineEmits<{ close: [] }>()

const language = useLanguageStore()
const { t } = useI18n()
</script>

<template>
  <OverlayShell :title="t('overlay.language')" @close="emit('close')">
    <ul class="lang-list">
      <li v-for="entry in LANGUAGES" :key="entry.code">
        <button
          type="button"
          class="lang"
          :class="{ active: entry.code === language.code }"
          :aria-pressed="entry.code === language.code"
          :lang="entry.code"
          :data-testid="`lang-${entry.code}`"
          @click="language.choose(entry.code)"
        >
          <span class="code">{{ entry.code }}</span>
          <span class="name">{{ entry.name }}</span>
        </button>
      </li>
    </ul>
  </OverlayShell>
</template>

<style scoped>
.lang-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
.lang {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  text-transform: none;
  letter-spacing: 0;
  padding: 0.6em 0.9em;
}
.lang .code {
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.lang .name {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--text);
}
.lang .note {
  margin-inline-start: auto;
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--gold);
}
.lang.active {
  border-color: var(--gold-deep);
  box-shadow: inset 2px 0 0 var(--gold);
}
.lang.active .code {
  color: var(--gold);
}
.soon {
  margin: 1rem 0 0;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-faint);
}
@media (max-width: 560px) {
  .lang-list {
    grid-template-columns: 1fr;
  }
}
</style>
