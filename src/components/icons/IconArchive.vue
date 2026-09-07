<script setup lang="ts">
/** A chest with a lid, and a book going into it or coming back out — which is
 *  what a backup is: the shelf packed away, or unpacked again. The arrow is
 *  the only thing that changes between the two, so the pair reads as one
 *  action in two directions rather than as two unrelated icons. */
defineProps<{ dir: 'out' | 'in' }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <!-- the chest: lid, then the body below it -->
      <path d="M3.8 13.4h16.4v6.4H3.8z" />
      <path d="M10.2 16.4h3.6" opacity="0.6" />
      <!-- out: rising from the chest. in: dropping into it. -->
      <template v-if="dir === 'out'">
        <path d="M12 10.4V3.6" />
        <path d="M8.9 6.6 12 3.5l3.1 3.1" />
      </template>
      <template v-else>
        <path d="M12 3.6v6.8" />
        <path d="M8.9 7.4 12 10.5l3.1-3.1" />
      </template>
    </g>
  </svg>
</template>
