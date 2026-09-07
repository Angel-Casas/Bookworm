<script setup lang="ts">
import OverlayShell from './OverlayShell.vue'
import SettingsPanel from './SettingsPanel.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <OverlayShell :title="t('overlay.settings')" wide @close="emit('close')">
    <SettingsPanel />
  </OverlayShell>
</template>
