<script setup lang="ts">
/** A gloss: a word on the line, underscored by hand, with a curl leading out
 *  to the little star a reader draws in the margin beside it. */
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <!-- the line of text, with one word standing out from it -->
      <path d="M3.6 8.2q4.2-.5 8.4 0" opacity="0.45" />
      <path d="M3.6 13.1h6.2" />
      <path d="M3.4 16.1q3.2 1 6.6-.2" />
      <path d="M3.6 19.6q3.6-.5 7.2 0" opacity="0.45" />
      <!-- the curl out into the margin, and the mark waiting there -->
      <path d="M11.4 15.2q4-.3 5.6-4.4" opacity="0.8" />
      <path d="M17.6 3.6v5.2M15 6.2h5.2" />
    </g>
  </svg>
</template>
