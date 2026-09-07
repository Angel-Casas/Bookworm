<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import OrnateFrame from '@/components/ui/OrnateFrame.vue'

defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay-root" role="dialog" aria-modal="true" :aria-label="title">
    <div class="overlay-scrim" @click="emit('close')"></div>
    <OrnateFrame class="overlay-panel" :class="{ wide }">
      <header class="overlay-head">
        <h1 class="overlay-title">{{ title }}</h1>
        <i class="head-rule" aria-hidden="true"></i>
      </header>
      <div class="overlay-body">
        <slot />
      </div>
    </OrnateFrame>
  </div>
</template>

<style scoped>
.overlay-root {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: clamp(3.6rem, 9vh, 6rem) 1rem 2rem;
  overflow-y: auto;
}
.overlay-scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  backdrop-filter: blur(2px);
}
.overlay-panel {
  position: relative;
  width: min(34rem, 100%);
  padding: 1.6rem 1.8rem 1.8rem;
}
.overlay-panel.wide {
  width: min(44rem, 100%);
}
.overlay-head {
  text-align: center;
  margin-bottom: 1.1rem;
}
.overlay-title {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.3rem;
  letter-spacing: 0.24em;
  text-indent: 0.24em;
  text-transform: uppercase;
  margin: 0;
}
.head-rule {
  display: block;
  height: 1px;
  width: 9rem;
  margin: 0.8rem auto 0;
  background: linear-gradient(to right, transparent, var(--hair), transparent);
}
</style>
