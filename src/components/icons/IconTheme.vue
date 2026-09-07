<script setup lang="ts">
defineProps<{ mode: 'dark' | 'light' }>()
</script>

<template>
  <!-- Reading light: a crescent for the dark room, a sun for the bright one. -->
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g
      v-if="mode === 'dark'"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14.5 3.6a8.7 8.7 0 1 0 5.6 13.9A7.1 7.1 0 0 1 14.5 3.6Z" />
      <path d="M17.6 4.6l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" opacity="0.6" />
    </g>
    <g v-else stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <circle cx="12" cy="12" r="4.4" />
      <path
        d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"
        opacity="0.7"
      />
    </g>
  </svg>
</template>
