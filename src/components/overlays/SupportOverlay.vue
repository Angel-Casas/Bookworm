<script setup lang="ts">
import { GITHUB_REPO_URL } from '@/config'
import OverlayShell from './OverlayShell.vue'
import { useI18n } from '@/i18n'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const CHANNELS = [
  {
    labelKey: 'support.bugLabel',
    descKey: 'support.bugDesc',
    href: `${GITHUB_REPO_URL}/issues/new?labels=bug`,
  },
  {
    labelKey: 'support.questionLabel',
    descKey: 'support.questionDesc',
    href: `${GITHUB_REPO_URL}/issues/new?labels=question`,
  },
  {
    labelKey: 'support.featureLabel',
    descKey: 'support.featureDesc',
    href: `${GITHUB_REPO_URL}/issues/new?labels=enhancement`,
  },
] as const
</script>

<template>
  <OverlayShell :title="t('overlay.support')" @close="emit('close')">
    <p class="lead">{{ t('support.lead') }}</p>
    <ul class="channels">
      <li v-for="channel in CHANNELS" :key="channel.labelKey">
        <a class="channel" :href="channel.href" target="_blank" rel="noopener">
          <span class="channel-label">{{ t(channel.labelKey) }}</span>
          <span class="channel-desc">{{ t(channel.descKey) }}</span>
          <span class="channel-arrow" aria-hidden="true">→</span>
        </a>
      </li>
    </ul>
    <p class="fine">{{ t('support.fine') }}</p>
  </OverlayShell>
</template>

<style scoped>
.lead {
  margin: 0 0 1.1rem;
  color: var(--text-dim);
  font-size: 0.9rem;
  text-align: center;
}
.channels {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.channel {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'label arrow'
    'desc arrow';
  gap: 0.1rem 0.8rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border: 1px solid var(--hair-soft);
  border-radius: 2px;
  text-decoration: none;
  transition:
    border-color 0.22s ease,
    background 0.22s ease;
}
.channel:hover {
  border-color: var(--hair);
  background: var(--bg-raise);
}
.channel-label {
  grid-area: label;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gold);
}
.channel-desc {
  grid-area: desc;
  font-size: 0.84rem;
  color: var(--text-dim);
}
.channel-arrow {
  grid-area: arrow;
  color: var(--gold);
  font-size: 1rem;
}
.fine {
  margin: 1.2rem 0 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}
</style>
