<script setup lang="ts">
/** Shelf-view glyph: a 2×2 spread of plates for the big-covers gallery, a 3×3
 *  for the compact view. Rounded strokes keep it in the handcrafted family. */
defineProps<{ cells: 2 | 3 }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g
      v-if="cells === 2"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="1" />
      <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1" />
      <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1" />
      <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1" />
    </g>
    <g
      v-else
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3.2" y="3.2" width="4.6" height="4.6" rx="0.8" />
      <rect x="9.7" y="3.2" width="4.6" height="4.6" rx="0.8" />
      <rect x="16.2" y="3.2" width="4.6" height="4.6" rx="0.8" />
      <rect x="3.2" y="9.7" width="4.6" height="4.6" rx="0.8" />
      <rect x="9.7" y="9.7" width="4.6" height="4.6" rx="0.8" />
      <rect x="16.2" y="9.7" width="4.6" height="4.6" rx="0.8" />
      <rect x="3.2" y="16.2" width="4.6" height="4.6" rx="0.8" />
      <rect x="9.7" y="16.2" width="4.6" height="4.6" rx="0.8" />
      <rect x="16.2" y="16.2" width="4.6" height="4.6" rx="0.8" />
    </g>
  </svg>
</template>
