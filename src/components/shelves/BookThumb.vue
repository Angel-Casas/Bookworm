<script setup lang="ts">
/**
 * A book's cover, small — for lists that name a book rather than show it off.
 * A book with no cover gets a plain block in the gold of the shelf, so a row of
 * them still lines up.
 */
import { computed, onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ cover: Blob | null }>()

const url = computed(() => (props.cover ? URL.createObjectURL(props.cover) : null))
watch(url, (_next, previous) => {
  if (previous) URL.revokeObjectURL(previous)
})
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <img v-if="url" :src="url" alt="" class="thumb" />
  <span v-else class="thumb blank" aria-hidden="true"></span>
</template>

<style scoped>
.thumb {
  display: block;
  flex: none;
  width: 1.6rem;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 1px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.blank {
  background: var(--bg-raise);
  border: 1px solid var(--hair-soft);
  box-sizing: border-box;
}
</style>
