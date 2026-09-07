<script setup lang="ts">
/** A quill laying down a swash of ink — the highlight tag, dipped in the
 *  highlight's own pastel via `tint`. */
defineProps<{ tint?: string }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      class="swash"
      d="M4.5 19.5c3.4-1.6 9.2-1.9 15-0.7"
      :stroke="tint ?? '#f2dd88'"
      stroke-width="3"
      stroke-linecap="round"
    />
    <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18.5 3.5c-5.6 1.6-9.4 5.4-11 11.5 4.7-0.9 8.9-4.6 11-11.5z" />
      <path d="M7.5 15c-0.7 0.9-1.2 1.8-1.5 2.9" opacity="0.7" />
      <path d="M17 5.5c-2.9 1.5-5.4 3.7-7.2 6.6" opacity="0.45" />
    </g>
  </svg>
</template>
