<script setup lang="ts">
/**
 * The light the page is read by: a sun for the pale page, a crescent for the
 * dark one.
 *
 * Cast SOLID on purpose. The nav bar's app-theme button uses the same pair in
 * fine outline, and two identical suns one row apart would be one picture
 * meaning two things; the filled weight belongs to the button that acts on
 * what the reader is actually looking at. The earlier attempts to say "page"
 * literally — a sun above, inside, or rising behind a sheet — all shrank the
 * sun below ~10px at the 16px it is drawn at, where its rays collapse into
 * something that reads as a cog (see Docs/LESSONS.md).
 */
defineProps<{ mode: 'light' | 'dark' }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <template v-if="mode === 'light'">
      <circle cx="12" cy="12" r="4.6" fill="currentColor" />
      <g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <path
          d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"
        />
      </g>
    </template>
    <path v-else d="M15 3.2a8.8 8.8 0 1 0 5.8 14.2A7.2 7.2 0 0 1 15 3.2Z" fill="currentColor" />
  </svg>
</template>
