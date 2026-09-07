<script setup lang="ts">
/** The book seen from above: one leaf lying open, or two facing across a
 *  spine. Drawn as pages rather than as abstract columns so the button reads
 *  as "how the book sits", which is what it changes. The scroll is the same
 *  leaf with no bottom edge and an arrow running off it — a page that keeps
 *  going, which is exactly what scrolling gives you. */
defineProps<{ mode: 'single' | 'double' | 'scroll' }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <template v-if="mode === 'single'">
        <path d="M7.5 4h9v16h-9z" />
        <path d="M10 8.5h4M10 11.5h4M10 14.5h2.5" opacity="0.5" />
      </template>
      <template v-else-if="mode === 'scroll'">
        <!-- A leaf that runs off the bottom of the frame … -->
        <path d="M7.5 3.5h9v13" opacity="0.9" />
        <path d="M7.5 3.5v13" opacity="0.9" />
        <path d="M10 7h4M10 10h4" opacity="0.5" />
        <!-- … and the way through it. -->
        <path d="M12 13.5v6.5M9.5 17.5 12 20l2.5-2.5" />
      </template>
      <template v-else>
        <path d="M3.5 4.5h7.5v15H3.5zM13 4.5h7.5v15H13z" />
        <!-- the spine between the leaves -->
        <path d="M12 4v16" opacity="0.55" />
        <path d="M5.5 8.5h3.5M5.5 11.5h3.5M15 8.5h3.5M15 11.5h3.5" opacity="0.5" />
      </template>
    </g>
  </svg>
</template>
