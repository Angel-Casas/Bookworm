<script setup lang="ts">
/**
 * Where the assistant sits, drawn as the split itself: a pane divided across
 * the bottom, or divided down the side. The icon shows the arrangement you
 * would be moving TO, since that is what pressing it does.
 */
defineProps<{ dock: 'drawer' | 'side' }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="1.4" />
      <template v-if="dock === 'drawer'">
        <!-- currently a drawer → offer the side column -->
        <path d="M14.6 4.6v14.8" />
        <path d="M14.6 4.6h6.2v14.8h-6.2z" fill="currentColor" fill-opacity="0.75" stroke="none" />
      </template>
      <template v-else>
        <!-- currently at the side → offer the drawer -->
        <path d="M3.2 13.8h17.6" />
        <path d="M3.2 13.8h17.6v5.6H3.2z" fill="currentColor" fill-opacity="0.75" stroke="none" />
      </template>
    </g>
  </svg>
</template>
